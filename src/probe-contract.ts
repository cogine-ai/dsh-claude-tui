export interface CompatibilityProbeResult {
  token: string
  package: 'dsh-claude-tui'
  version: string
  services: ['agentDefaultModel', 'agents', 'commands', 'sessions']
}
