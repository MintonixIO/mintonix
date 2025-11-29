import { Button } from "@/components/ui/button";
import Link from "next/link";

export function Hero() {
  return (
    <div className="flex flex-col gap-16 items-center text-center max-w-4xl mx-auto px-4">
      <div className="flex flex-col gap-8 items-center">
        <h1 className="text-4xl lg:text-6xl font-bold !leading-tight">
          <span className="text-blue-500">Elevate </span>
           Your Badminton Game with{" "}
          <span className="text-blue-500">AI-Powered</span> Analytics
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl">
          Transform your badminton training with monocular video analysis. Get real-time insights, 
          personalized coaching feedback, and track your progress like never before.
        </p>
      </div>
      
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <Button size="lg" asChild>
          <Link href="/upload">Upload Video</Link>
        </Button>
        <Button variant="outline" size="lg" asChild>
          <Link href="/blog">Case Study</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full mt-16">
        <div className="flex flex-col items-center gap-4 p-6">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Video Analysis</h3>
          <p className="text-sm text-muted-foreground">
            Upload your badminton videos and get instant AI-powered analysis of your technique and performance.
          </p>
        </div>
        
        <div className="flex flex-col items-center gap-4 p-6">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 00-2-2m0 0V5a2 2 0 012-2h2a2 2 0 00-2-2m-6 0V3a2 2 0 012-2h2a2 2 0 002-2" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Performance Metrics</h3>
          <p className="text-sm text-muted-foreground">
            Track your improvement with detailed analytics on shot accuracy, speed, and technique consistency.
          </p>
        </div>
        
        <div className="flex flex-col items-center gap-4 p-6">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">AI Coaching</h3>
          <p className="text-sm text-muted-foreground">
            Receive personalized coaching tips and training recommendations based on your playing style.
          </p>
        </div>
      </div>

      <div className="w-full p-[1px] bg-gradient-to-r from-transparent via-foreground/10 to-transparent my-8" />
    </div>
  );
}
