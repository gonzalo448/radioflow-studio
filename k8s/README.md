## Kubernetes (manifests básicos)

Estos manifests son una traducción directa del `docker-compose.prod.yml` endurecido.

### Requisitos

- Un cluster con `kubectl`
- Un StorageClass por defecto (para PVCs)

### Deploy rápido

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/api.yaml
```

### Variables a ajustar

- `k8s/secret.yaml`:
  - `POSTGRES_PASSWORD`
  - `JWT_SECRET`
  - (opcional) passwords de Icecast si lo desplegas
- `k8s/api.yaml`:
  - `CORS_ORIGIN` (dominio del panel) o `none`
  - `BODY_LIMIT_BYTES` y limpieza de refresh tokens

### Ingress (opcional)

Si tienes un ingress controller, aplica:

```bash
kubectl apply -f k8s/ingress.yaml
```

