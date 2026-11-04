# Local TLS regression identity

Self-signed localhost/127.0.0.1 test identity generated solely for the undici
custom-certificate-verifier regression. The private key is public test data,
not an application credential. The test trusts this certificate explicitly;
normal TLS verification remains enabled. These files are excluded from npm.
