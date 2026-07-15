## Kubernetes production-grade (v0.1)

Este directorio agrega hardening sobre los manifests básicos en `k8s/`.

Incluye:
- Postgres y Redis como **StatefulSet** (PVC por pod)
- **resources** (requests/limits)
- **PodDisruptionBudget**
- **NetworkPolicy** (deny-by-default + allow explícito)
- **Ingress TLS** con `cert-manager` (cluster issuer)

### Requisitos
- Ingress controller instalado (NGINX u otro)
- `cert-manager` instalado y un `ClusterIssuer` disponible (por ejemplo `letsencrypt-prod`)
- StorageClass por defecto

> Recomendado para producción real: usar Postgres/Redis **administrados** y aplicar `k8s/prod-managed/`.

### Aplicación

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/prod/networkpolicy.yaml
kubectl apply -f k8s/prod/postgres-statefulset.yaml
kubectl apply -f k8s/prod/redis-statefulset.yaml
kubectl apply -f k8s/prod/api-deployment.yaml
kubectl apply -f k8s/prod/pdb.yaml
kubectl apply -f k8s/prod/ingress-tls.yaml
```

### Ajustes obligatorios
- `k8s/secret.yaml`: `POSTGRES_PASSWORD`, `JWT_SECRET`
- `k8s/prod/ingress-tls.yaml`: `host`, `secretName`, `cluster-issuer`
- `k8s/prod/api-deployment.yaml`: `CORS_ORIGIN`

