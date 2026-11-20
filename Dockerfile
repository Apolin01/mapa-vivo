FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY . .
# El servidor lee PORT (lo define la plataforma) y exige ACCESO_CLAVE; los datos se descargan del sheet al arrancar
CMD ["python", "servidor.py", "--sin-ia"]
