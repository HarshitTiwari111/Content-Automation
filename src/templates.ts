import type { ArticleRow, CampaignTemplate } from './types.js';

/**
 * Row ke liye template dhoondhna (PDF section 8/13).
 *
 * Kram:
 *   1. Row ka Template column (agar Sheet me hai aur bhara hai)
 *   2. Row ka Topic/Intent — usi naam ki row CAMPAIGN_TEMPLATES me
 *   3. CAMPAIGN_TEMPLATES me sirf ek hi template ho to wahi
 */

/** "Software & Apps" aur "software and apps" ek jaise maane jaate hain. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findTemplateFor(
  row: ArticleRow,
  templates: Map<string, CampaignTemplate>,
): CampaignTemplate | undefined {
  const byName = (wanted: string): CampaignTemplate | undefined => {
    if (!wanted) return undefined;
    const key = normalise(wanted);
    for (const template of templates.values()) {
      if (normalise(template.name) === key) return template;
    }
    return undefined;
  };

  return (
    byName(row.template) ??
    byName(row.topic) ??
    (templates.size === 1 ? [...templates.values()][0] : undefined)
  );
}

/**
 * Campaign ke naam ka aakhri hissa.
 * Topic/Intent pehle — jaise "SITE-4 | GF-3916 | DISPLAY | US | HEALTH".
 * Topic khaali ho to template ka naam.
 */
export function templateLabel(row: ArticleRow, template?: CampaignTemplate): string {
  const source = row.topic || row.template || template?.name || '';
  return source
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
