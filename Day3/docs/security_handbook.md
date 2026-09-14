# NebulaCloud Security Operations & Compliance Handbook

## 1. Zero Trust Architecture & Authentication
NebulaCloud enforces a Zero Trust security perimeter across internal services and external APIs.
- Every internal microservice connection requires Mutual TLS (mTLS) with cryptographically attested x509 certificates managed by SPIFFE/SPIRE.
- User identity is verified via OpenID Connect (OIDC) with mandatory multi-factor authentication (FIDO2/WebAuthn hardware security keys).
- Session tokens expire after 15 minutes of inactivity; refresh tokens have a strict 12-hour lifetime and are bound to device fingerprints.

## 2. Cryptographic Standards & Key Management
- **Data at Rest**: All block volumes, object stores, and database backups are encrypted using AES-256-GCM. Master encryption keys are hosted in AWS KMS and Cloud KMS with automatic annual rotation.
- **Data in Transit**: Transport Layer Security (TLS) 1.3 is enforced with forward secrecy (ECDHE-RSA-AES256-GCM-SHA384 or ChaCha20-Poly1305). TLS 1.0, 1.1, and 1.2 are rejected at the edge gateway.
- **Service API Credentials**: Service account API keys and secret access tokens must be rotated every 90 days. Automated revocation alerts are dispatched 14 days prior to credential expiry.

## 3. Vulnerability Management & Incident Response
- All container images must pass vulnerability scanning in the CI/CD pipeline using Trivy and Grype. Any image containing critical CVEs with CVSS >= 9.0 is blocked from production deployment.
- Security Incident Response follows the NIST SP 800-61 framework:
  1. Severity 1 (Active breach or data leak): Incident Commander assigned within 5 minutes; initial executive containment within 30 minutes.
  2. Severity 2 (Privilege escalation vector): Response team mobilized within 30 minutes; patch deployment within 4 hours.
