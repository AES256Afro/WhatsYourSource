import type { Claim } from '@/lib/pipeline/schema';
import { Cite, Count, Label, Pill, toneForClaim } from './common';

const STATUS_LABEL = { supported: 'Supported', disputed: 'Disputed', misleading: 'Misleading', unverified: 'Unverified' } as const;

export function ClaimList({ claims }: { claims: Claim[] }) {
  if (claims.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        Claims found <Count n={claims.length} />
      </Label>
      {claims.map((c, i) => (
        <div key={i} className="wys-card flex flex-col gap-1 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grow text-[13px] font-medium">{c.text}</span>
            <Pill tone={toneForClaim(c.status)}>{STATUS_LABEL[c.status]}</Pill>
          </div>
          {(c.note || c.sourceIds.length > 0) && (
            <span className="text-[12px] leading-[17px] text-ink-2">
              {c.note}{' '}
              {c.sourceIds.map((id) => (
                <Cite key={id} id={id} />
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
