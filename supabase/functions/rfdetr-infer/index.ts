import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

// RF-DETR COCO-pretrained checkpoints are exposed on the Roboflow hosted API as
// real `project/version` resources. The friendly aliases below are resolved
// client-side by the `inference` SDK; the raw HTTP endpoint does NOT resolve
// them (it 404s), so we resolve them here. Source of truth:
// https://github.com/roboflow/inference/blob/main/inference_sdk/http/utils/aliases.py
const RF_DETR_ALIASES: Record<string, string> = {
  // Object detection (no segmentation masks)
  "rfdetr-base": "coco/36",
  "rfdetr-nano": "coco/38",
  "rfdetr-small": "coco/39",
  "rfdetr-medium": "coco/40",
  "rfdetr-large": "coco/50",
  "rfdetr-xlarge": "coco/47",
  "rfdetr-2xlarge": "coco/48",
  // Instance segmentation (returns polygon `points`)
  "rfdetr-seg-preview": "coco-dataset-vdnr1/26",
  "rfdetr-seg-nano": "coco-dataset-vdnr1/41",
  "rfdetr-seg-small": "coco-dataset-vdnr1/36",
  "rfdetr-seg-medium": "coco-dataset-vdnr1/37",
  "rfdetr-seg-large": "coco-dataset-vdnr1/38",
  "rfdetr-seg-xlarge": "coco-dataset-vdnr1/39",
  "rfdetr-seg-2xlarge": "coco-dataset-vdnr1/40",
}

// Resolve a friendly alias (e.g. "rfdetr-seg-preview") to its `project/version`
// path. A custom-trained model is passed through as `modelId/version`.
function resolveModelPath(modelId: string, version: string): string {
  const alias = RF_DETR_ALIASES[modelId.toLowerCase()]
  if (alias) return alias
  return modelId.includes("/") ? modelId : `${modelId}/${version}`
}

interface RoboflowPoint {
  x: number
  y: number
}

interface RoboflowPrediction {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
  class_id: number
  points?: RoboflowPoint[] | number[][]
  detection_id?: string
}

interface RoboflowResponse {
  predictions: RoboflowPrediction[]
  image: { width: number; height: number }
}

interface SegmentedPerson {
  bbox: { x: number; y: number; width: number; height: number }
  confidence: number
  segmentation?: { x: number; y: number }[]
  detection_id?: string
}

function normalizePoints(
  points?: RoboflowPoint[] | number[][],
): { x: number; y: number }[] | undefined {
  if (!points || !Array.isArray(points) || points.length === 0) return undefined

  if (Array.isArray(points[0])) {
    return (points as number[][]).map(([x, y]) => ({ x, y }))
  }

  return points as RoboflowPoint[]
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json() as {
      image?: string
      imageUrl?: string
      modelId?: string
      version?: string
      filterClasses?: string[] | string
    }

    const { image, imageUrl, modelId, version, filterClasses } = body

    if (!image && !imageUrl) {
      return new Response(
        JSON.stringify({
          error: "Either 'image' (base64) or 'imageUrl' is required",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const apiKey = Deno.env.get("ROBOFLOW_API_KEY")
    const configuredModelId = modelId ?? Deno.env.get("RF_DETR_MODEL_ID") ??
      "rfdetr-seg-preview"
    const configuredVersion = version ?? Deno.env.get("RF_DETR_MODEL_VERSION") ?? "1"

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ROBOFLOW_API_KEY environment variable is not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    // Roboflow's serverless host resolves both detection and segmentation
    // models from the same `project/version` path; it returns polygon `points`
    // when the model is a segmentation checkpoint (e.g. rfdetr-seg-*).
    const modelPath = resolveModelPath(configuredModelId, configuredVersion)
    const roboflowUrl = new URL(`https://serverless.roboflow.com/${modelPath}`)
    roboflowUrl.searchParams.set("api_key", apiKey)

    const requestInit: RequestInit = {
      method: "POST",
    }

    if (imageUrl) {
      roboflowUrl.searchParams.set("image", imageUrl)
      requestInit.headers = { "Content-Type": "application/json" }
    } else if (image) {
      const cleanImage = image.replace(/^data:image\/\w+;base64,/, "")
      requestInit.body = cleanImage
      requestInit.headers = { "Content-Type": "application/x-www-form-urlencoded" }
    }

    const response = await fetch(roboflowUrl.toString(), requestInit)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Roboflow API error:", response.status, errorText)
      return new Response(
        JSON.stringify({
          error: `Roboflow API returned ${response.status}`,
          details: errorText,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const result: RoboflowResponse = await response.json()

    const allPredictions = result.predictions.map((p) => ({
      class: p.class,
      confidence: p.confidence,
      bbox: { x: p.x, y: p.y, width: p.width, height: p.height },
      segmentation: normalizePoints(p.points),
      detection_id: p.detection_id,
    }))

    const rawFilter = filterClasses ?? Deno.env.get("RF_DETR_FILTER_CLASSES")
    let filtered = allPredictions
    if (rawFilter) {
      const classes = Array.isArray(rawFilter)
        ? rawFilter.map((c) => c.toLowerCase())
        : rawFilter.split(",").map((c) => c.trim().toLowerCase())
      filtered = allPredictions.filter((p) => classes.includes(p.class.toLowerCase()))
    }

    return new Response(
      JSON.stringify({
        success: true,
        predictions: allPredictions,
        filtered: filtered,
        total_predictions: allPredictions.length,
        total_filtered: filtered.length,
        image_size: result.image,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("rfdetr-infer error:", err)
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}

serve(handler, { port: Number(Deno.env.get("PORT") ?? 8000) })
