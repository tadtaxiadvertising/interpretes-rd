import type { Client } from 'pg';
import { readRoleplayBudgetAccounting } from '../src/lib/roleplay/direct-upload-budget-accounting';

const categories=['legacy','staging','final','other-private','opening','other-buckets'] as const;
type Category=typeof categories[number];
type InventoryRow={category:Category;objects:string;known_bytes:string;unknown_size_objects:string};

export const ROLEPLAY_STORAGE_INVENTORY_SQL=`
WITH inventory AS (
 SELECT CASE WHEN bucket_id='roleplay-audio' THEN 'legacy'
   WHEN bucket_id='roleplay-audio-private' AND name LIKE 'staging/roleplay/%' THEN 'staging'
   WHEN bucket_id='roleplay-audio-private' AND name LIKE 'base/%' THEN 'final'
   WHEN bucket_id='roleplay-audio-private' THEN 'other-private'
   WHEN bucket_id='roleplay-opening-private' THEN 'opening' ELSE 'other-buckets' END AS category,
   CASE WHEN metadata->>'size' ~ '^[0-9]{1,15}$' THEN (metadata->>'size')::numeric END AS bytes
 FROM storage.objects
)
SELECT category,count(*)::text AS objects,coalesce(sum(bytes),0)::text AS known_bytes,
 count(*) FILTER(WHERE bytes IS NULL)::text AS unknown_size_objects
FROM inventory GROUP BY category ORDER BY category`;

function unsigned(value:unknown):bigint{
  if(typeof value!=='string' || !/^(0|[1-9][0-9]{0,29})$/.test(value)) throw new Error('INVALID_INVENTORY');
  return BigInt(value);
}

/** Caller must use a read-only, repeatable-read transaction. Aggregate-only:
 * never return object paths, identities, tokens, or individual reservations.
 * Storage metadata is not a provider billing meter or proof of deletion. */
export async function readRoleplayStorageBudgetAudit(db:Pick<Client,'query'>){
  const inventory=await db.query<InventoryRow>(ROLEPLAY_STORAGE_INVENTORY_SQL);
  const observed=new Map<Category,InventoryRow>();
  let known=BigInt(0),unknown=BigInt(0),objects=BigInt(0);
  for(const row of inventory.rows){
    if(!categories.includes(row.category) || observed.has(row.category)) throw new Error('INVALID_INVENTORY');
    const n=unsigned(row.objects),b=unsigned(row.known_bytes),u=unsigned(row.unknown_size_objects);
    if(u>n || n===BigInt(0)) throw new Error('INVALID_INVENTORY');
    observed.set(row.category,row);objects+=n;known+=b;unknown+=u;
  }
  const totals={
    objects:objects.toString(),knownBytes:known.toString(),unknownSizeObjects:unknown.toString(),
    byCategory:categories.map(category=>{
      const r=observed.get(category);
      return {category,objects:r?.objects??'0',knownBytes:r?.known_bytes??'0',unknownSizeObjects:r?.unknown_size_objects??'0'};
    }),
  };
  return {inventory:totals,...await readRoleplayBudgetAccounting(db)};
}
