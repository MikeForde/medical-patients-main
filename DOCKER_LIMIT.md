# Fixing Docker Hub `unauthorized: pull rate limit exceeded` on OpenShift

When OpenShift tries to pull base images from **docker.io** (Docker Hub), you can hit Docker Hub’s unauthenticated pull limits and see failures like:

- `unauthorized: pull rate limit exceeded`
- `toomanyrequests: You have reached your pull rate limit`

A reliable workaround is to:

1. Authenticate OpenShift to Docker Hub (using a Docker Hub Personal Access Token)
2. Import the image into an OpenShift ImageStream
3. Build from the internal OpenShift registry instead of pulling from Docker Hub during builds

This avoids repeated external pulls and stabilizes builds.

---

## Example scenario

Base image:

```text
node:22-alpine
```

---

## Key steps (worked method)

### 1. Log into the cluster with `oc`

OpenShift console → **Command line tools** → **Copy login command** → paste into your terminal.

---

### 2. Identify your namespace (project)

```bash
oc project -q
```

Example output:

```text
made-upforthis-guide
```

---

### 3. Optional: store the namespace in a variable

```bash
NS="made-upforthis-guide"
```

---

### 4. Create a Docker Hub Personal Access Token (PAT)

Create a PAT in Docker Hub and copy it:

Docker Hub → **Account settings** → **Personal access tokens**

> Use a PAT (recommended) rather than your Docker Hub password.

---

### 5. Create (or update) a Docker registry pull secret in OpenShift

```bash
oc -n "$NS" create secret docker-registry dockerhub-pull \
  --docker-server=docker.io \
  --docker-username="YOUR_DOCKERHUB_USERNAME" \
  --docker-password="dckr_pat_REPLACE_ME" \
  --docker-email="YOUR_EMAIL@example.com" \
  --dry-run=client -o yaml | oc apply -f -
```

---

### 5a. Make sure builds can use the secret (important)

Attach the secret to the **builder** service account (commonly used by BuildConfigs):

```bash
oc -n "$NS" secrets link builder dockerhub-pull --for=pull
```

If your build uses the **default** service account instead, also link it:

```bash
oc -n "$NS" secrets link default dockerhub-pull --for=pull
```

Quick check:

```bash
oc -n "$NS" describe sa builder
```

---

### 6. Create an ImageStream for the image (if not already present)

```bash
oc -n "$NS" create imagestream node --dry-run=client -o yaml | oc apply -f -
```

---

### 7. Import the Docker Hub image into the ImageStream

This pulls **once** (authenticated), then OpenShift can serve it internally.

```bash
oc -n "$NS" import-image node:22-alpine \
  --from=docker.io/library/node:22-alpine \
  --confirm \
  --reference-policy=local
```

#### Why `--reference-policy=local`?

It tells OpenShift to rewrite the ImageStreamTag to reference the **internal registry location**, so builds pull from inside the cluster (not Docker Hub).

---

### 8. Verify the ImageStreamTag exists and resolves

```bash
oc -n "$NS" get istag node:22-alpine
oc -n "$NS" describe istag node:22-alpine
```

You should see it reference the internal registry.

---

### 9. Update your Dockerfile `FROM` to pull from the OpenShift internal registry

**Original:**

```dockerfile
FROM node:22-alpine AS ui-builder
```

**Becomes (namespace substituted):**

```dockerfile
FROM image-registry.openshift-image-registry.svc:5000/made-upforthis-guide/node:22-alpine AS ui-builder
```

If you used `NS`:

```dockerfile
FROM image-registry.openshift-image-registry.svc:5000/${NS}/node:22-alpine AS ui-builder
```

> Tip: If you’re using a BuildConfig with Docker strategy, you can sometimes reference the ImageStreamTag directly (setup-dependent), but the internal registry URL is the most explicit and consistent approach.

---

### 10. Rebuild in the OpenShift GUI

Trigger a new build from the OpenShift web console  
(or via `oc start-build ...` if you prefer).

---

## Troubleshooting

### Still getting Docker Hub pull-limit errors?

- Confirm the secret exists:
  ```bash
  oc -n "$NS" get secret dockerhub-pull
  ```

- Confirm the build service account has it linked:
  ```bash
  oc -n "$NS" describe sa builder
  ```

- Check build logs for what it’s pulling and from where:
  ```bash
  oc -n "$NS" get builds
  oc -n "$NS" logs build/<build-name>
  ```

---

### ImageStreamTag missing after import?

Re-run the import with `--confirm` and inspect events:

```bash
oc -n "$NS" import-image node:22-alpine \
  --from=docker.io/library/node:22-alpine \
  --confirm \
  --reference-policy=local

oc -n "$NS" get events --sort-by=.lastTimestamp | tail -n 30
```

---

### Confirm internal registry availability

The internal registry service is typically:

```text
image-registry.openshift-image-registry.svc:5000
```

(If your cluster is configured differently, your admin may have a custom registry route or settings.)

---

## Notes / best practices

- Treat the Docker Hub PAT as a secret; rotate it periodically.
- Prefer importing frequently-used base images (`node`, `python`, `ubi`, etc.) into ImageStreams for stability.
- If multiple namespaces need the same base images, consider a shared “tools” namespace pattern (organisation-dependent).

---

If you want, paste your exact BuildConfig strategy (Docker vs Buildah vs Pipeline), and this guide can be tailored further for your setup.
