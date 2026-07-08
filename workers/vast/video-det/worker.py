from vastai import HandlerConfig, LogActionConfig, Worker, WorkerConfig

_config = WorkerConfig(
    backend=HandlerConfig(
        app="handler:app",
        port=8080,
    ),
    ready_actions=[
        LogActionConfig(pattern="Application startup complete"),
    ],
)

if __name__ == "__main__":
    Worker(_config).run()
