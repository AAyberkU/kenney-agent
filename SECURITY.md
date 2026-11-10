# Security

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/AAyberkU/kenney-agent/security/advisories/new),
not in a public issue.

kenney-agent downloads pack zips from kenney.nl and an index archive from this
repository's releases. Both are treated as untrusted data: entries are written
only inside their destination folder and nothing in them is executed. Reports
about those paths are especially welcome.
