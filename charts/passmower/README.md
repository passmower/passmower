# Passmower chart

Install published releases from `oci://ghcr.io/passmower/charts/passmower`.
The checked-in `Chart.yaml` version is a development placeholder. CI packages
release versions from Git tags without changing source files.

Published charts pin `image.digest` to the image built for the release. That
image is used by both Passmower and the signing-key initialization Job.
To override the image, clear the digest and set the repository/tag explicitly:

```sh
helm upgrade --install passmower oci://ghcr.io/passmower/charts/passmower \
  --namespace passmower --set image.digest= \
  --set image.repository=registry.example.com/passmower --set image.tag=my-build
```

The source chart defaults to the stable `latest` image when neither a tag nor a
digest is supplied. Skaffold overrides these settings with its locally built
image. See `values.yaml` for configuration and the repository's
[local development guide](../../docs/local-development.md) for existing clusters.
