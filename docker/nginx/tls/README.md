Colocá aquí los PEM del sitio (solo en el servidor; no commitees claves privadas):

| Archivo        | Uso habitual        |
|----------------|---------------------|
| `fullchain.pem`| Certificado + cadena (Let's Encrypt: `fullchain.pem`) |
| `privkey.pem`  | Clave privada        |

Montaje en el contenedor: lectura en `/etc/nginx/tls/` (ver `docker-compose.edge.tls.yml`).
