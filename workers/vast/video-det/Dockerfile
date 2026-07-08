# TensorRT 24.04 base includes CUDA 12.4, cuDNN 9, TensorRT 10, Python 3.10
FROM nvcr.io/nvidia/tensorrt:24.04-py3

WORKDIR /app

# PyTorch must be installed separately; pin to a CUDA 12.1-compatible wheel
RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 \
    --index-url https://download.pytorch.org/whl/cu121

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Model weights are mounted or downloaded at container start
RUN mkdir -p /app/models

EXPOSE 8080

CMD ["python3", "worker.py"]
