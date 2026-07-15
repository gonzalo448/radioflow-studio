## Kubernetes (prod recomendado): DB/Redis administrados

Esta variante evita correr Postgres/Redis dentro del cluster y usa servicios administrados.

### Qué aplicas

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/prod-managed/secret-external.yaml
kubectl apply -f k8s/prod-managed/networkpolicy-ingress-nginx.yaml
kubectl apply -f k8s/prod-managed/migrate-job.yaml
# espera a que termine OK
kubectl -n radioflow wait --for=condition=complete job/radioflow-db-migrate --timeout=180s
kubectl apply -f k8s/prod-managed/api-deployment.yaml
kubectl apply -f k8s/prod/pdb.yaml
kubectl apply -f k8s/prod/ingress-tls.yaml
```

### Requisitos
- Ingress controller: `ingress-nginx` (si usas otro, ajusta la NetworkPolicy)
- `cert-manager` + `ClusterIssuer` (ej. `letsencrypt-prod`)

### Variables
- `k8s/prod-managed/secret-external.yaml`
  - `DATABASE_URL`: URL del Postgres administrado
  - `REDIS_URL`: URL del Redis administrado (opcional; si no lo usas, quítalo y deja `REDIS_URL` vacío)
  - `JWT_SECRET`
- Alternativa: External Secrets Operator
  - Usa `k8s/prod-managed/externalsecrets-example.yaml` para generar el Secret `radioflow-secrets` desde tu Secret Manager/Vault.
- `k8s/prod/ingress-tls.yaml`
  - host + secretName + cluster-issuer

### Nota sobre NetworkPolicy y servicios administrados
Las NetworkPolicies estándar no filtran por FQDN. Aquí se deja egress mínimo por **puerto**
(443/5432/6379 + DNS). Si tu CNI soporta FQDN policies (Cilium), se puede endurecer más.

