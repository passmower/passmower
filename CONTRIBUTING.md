# Contributing to Passmower

Thank you for your interest in contributing to Passmower!
We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Code of Conduct

This project follows the [CNCF Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold it.

## Getting started

1. **Fork** the repository and clone your fork.
2. Set up the local development environment — see [docs/local-development.md](docs/local-development.md).
   The `scripts/dev-minikube.sh` script creates an isolated minikube profile with Redis,
   a stub Dex upstream, and HTTPS via sslip.io. No external credentials are needed.
3. Create a **topic branch** (`git checkout -b fix/my-fix`).
4. Make your changes and run the tests (see [Running tests](#running-tests)).
5. Open a pull request against `master`.

## Running tests

```sh
# Unit and integration tests
npm test

# End-to-end tests (requires the local dev stack to be running)
npm run test:e2e
```

## Opening issues

- **Bug reports**: include steps to reproduce, expected vs actual behaviour, and Passmower version.
- **Feature requests**: describe the use case, not just the implementation.
- **Security vulnerabilities**: do **not** open a public issue.
  Contact the maintainers listed in [MAINTAINERS.md](MAINTAINERS.md) directly by email.

## Pull request guidelines

- Keep PRs focused — one logical change per PR.
- Add or update tests for changed behaviour.
- Update the relevant documentation in `docs/` and the `README.md` if needed.
- Ensure `npm test` passes locally before opening the PR.
- New Helm values must be documented in `charts/passmower/values.yaml` and reflected in `charts/passmower/README.md`.

## Maintainers

See [MAINTAINERS.md](MAINTAINERS.md).
Maintainer status is earned through sustained, high-quality contributions
and is reviewed via a pull request to `MAINTAINERS.md`.
