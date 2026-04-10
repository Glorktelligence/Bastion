<script>
// Skills — M16 admin page
// Informational view — skills are managed on the AI client
</script>

<div class="skills-page">
	<h2>Skills</h2>

	<div class="status-banner">
		Skills are managed on the AI client. Skill scanning, quarantine, and approval happen locally on the AI VM.
	</div>

	<div class="info-grid">
		<div class="info-card">
			<h3>SkillsManager</h3>
			<p>The SkillsManager runs on the AI client and handles the full skill lifecycle:</p>
			<ul>
				<li><strong>Forensic scanning</strong> — Skills are scanned for safety violations before activation</li>
				<li><strong>Quarantine pipeline</strong> — New or modified skills enter quarantine until reviewed</li>
				<li><strong>Hot-reload</strong> — Skills can be reloaded without restarting the AI client</li>
				<li><strong>Token budgeting</strong> — Each skill declares estimated token usage for context management</li>
			</ul>
		</div>

		<div class="info-card">
			<h3>Skill Structure</h3>
			<p>Each skill declares:</p>
			<ul>
				<li><strong>Triggers</strong> — Conditions that activate the skill (message patterns, commands)</li>
				<li><strong>Modes</strong> — Which conversation modes the skill applies to (conversation, task, etc.)</li>
				<li><strong>Estimated tokens</strong> — Context budget consumed when active</li>
				<li><strong>Always-load flag</strong> — Whether the skill is loaded into every conversation</li>
			</ul>
		</div>

		<div class="info-card">
			<h3>Protocol Integration</h3>
			<p>Skill data flows through the protocol via <code>skill_list_response</code> messages. The relay can surface skill metadata from connected AI clients, but does not manage skills directly.</p>
			<p class="muted">The skills directory path and active skill list are configured on the AI VM, not the relay.</p>
		</div>

		<div class="info-card">
			<h3>Security</h3>
			<p>Skills operate under the same safety boundaries as all other Bastion components:</p>
			<ul>
				<li>MaliClaw Clause applies to skill content and identifiers</li>
				<li>Safety floors cannot be lowered by skills</li>
				<li>Dangerous tool calls within skills still require per-call approval</li>
				<li>Skill file changes are audited</li>
			</ul>
		</div>
	</div>
</div>

<style>
	.skills-page h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.status-banner {
		font-size: 0.875rem;
		color: var(--text-secondary);
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, var(--status-info) 10%, var(--bg-surface));
		border: 1px solid color-mix(in srgb, var(--status-info) 30%, var(--border-default));
		border-radius: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.info-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
	}

	.info-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.info-card h3 {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
	}

	.info-card p {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		line-height: 1.5;
	}

	.info-card ul {
		list-style: disc;
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.info-card li {
		padding: 0.25rem 0;
		line-height: 1.4;
	}

	.info-card code {
		color: var(--accent-secondary);
		font-size: 0.75rem;
		background: var(--bg-secondary);
		padding: 0.1rem 0.25rem;
		border-radius: 0.125rem;
	}

	.muted {
		color: var(--text-muted);
		font-style: italic;
	}
</style>
