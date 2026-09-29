import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../../../packages/ui-tokens/src/index.ts',import.meta.url),'utf8');
const light=source.split('export const lightTokens = {')[1].split('} as const')[0];
const keys=['background','card','foreground','secondary','mutedForeground','chatUser','border'];
const values=keys.map(key=>{const value=light.match(new RegExp(`\\b${key}: "(#[A-Fa-f0-9]+)"`))?.[1];if(!value)throw new Error(`Missing token ${key}`);return `    static let ${key} = "${value}"`});
writeFileSync(new URL('../Sources/Palette.generated.swift',import.meta.url),`// Generated from @rakazo/ui-tokens. Run Scripts/generate-theme.mjs.\nenum Palette {\n${values.join('\n')}\n}\n`);

// Keep the original avatar geometry and ordering shared across clients.
const shapesSource = readFileSync(new URL('../../../packages/core/src/bot-avatar-shapes.ts', import.meta.url), 'utf8');
const paths = Object.fromEntries([...shapesSource.matchAll(/(\w+):\s*"([MLCQZ][^"]+)"/g)].map(m => [m[1], m[2]]));
const shapeKeys = shapesSource.split('export const SHIPPED_BOT_AVATAR_SHAPE_KEYS = [')[1]?.split('] as const')[0]?.match(/"([^"]+)"/g)?.map(v => JSON.parse(v));
if (!shapeKeys?.length || shapeKeys.some(k => !paths[k])) throw new Error('Avatar shape source changed');
writeFileSync(new URL('../Resources/AvatarShapes.json', import.meta.url), JSON.stringify(shapeKeys.map(k => paths[k])) + '\n');
const consentSource = readFileSync(new URL('../../../packages/contracts/src/ai-consent.ts', import.meta.url), 'utf8');
const disclosures = [...consentSource.split('AI_DATA_DISCLOSURES:')[1].split('};')[0].matchAll(/(model|voice|memory):\s*"([^"]+)"/g)];
const privacyURL = consentSource.match(/AI_PRIVACY_URL = "([^"]+)"/)[1];
writeFileSync(new URL('../Sources/ConsentCopy.generated.swift', import.meta.url), `// Generated from @rakazo/contracts by Scripts/generate-theme.mjs.\nenum ConsentCopy {\n  static let privacyURL = ${JSON.stringify(privacyURL)}\n  static let disclosures: [String: String] = [\n${disclosures.map(m => `    "${m[1]}": ${JSON.stringify(m[2])},`).join('\n')}\n  ]\n}\n`);
