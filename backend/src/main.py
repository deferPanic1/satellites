import fastapi
import fastapi.middleware.gzip
import uvicorn

import src.api.validation_router

MIN_COMPRESSION_THRESHHOLD: int = 1000

app = fastapi.FastAPI(
    title='Cosmo Constellation Designer API',
    version='1.0.0',
    description='API сервиса симуляции спутниковой связи'
)

app.add_middleware(
    fastapi.middleware.gzip.GZipMiddleware,
    minimum_size=MIN_COMPRESSION_THRESHHOLD,
)

app.include_router(src.api.validation_router.router, prefix='/api')


@app.get('/api/health/')
async def health() -> dict:
    return {
        'status': 'ok',
    }
