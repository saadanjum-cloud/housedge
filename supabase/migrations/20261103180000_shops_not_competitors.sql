-- Shops that sell the products (electronics chains, Amazon) are where to buy, not competitors: drop them from the
-- stored competitor suggestions, as the reading code now does (extract.js suggestable). Kept where the answer
-- describes the client as a shop too. Readings stored as JSON text are read either way.
with r as (
  select x.answer_id, a.project_id, case jsonb_typeof(x.data) when 'string' then (x.data #>> '{}')::jsonb else x.data end d
  from extractions x join answers a on a.id = x.answer_id
), shops as (
  select r.answer_id, e->>'name' name
  from r, jsonb_array_elements(r.d->'entities') e
  where e->>'descriptor' ~* '\m(retailer|retail chain|reseller|stockist|department store|electronics store|online store|online shop)\M'
    and not exists (
      select 1 from jsonb_array_elements(r.d->'entities') o join brands b on b.project_id = r.project_id and b.is_own
      where lower(o->>'name') = lower(b.name)
        and o->>'descriptor' ~* '\m(retailer|retail chain|reseller|stockist|department store|electronics store|online store|online shop)\M')
)
delete from other_brands ob using shops s where ob.answer_id = s.answer_id and ob.name = s.name;
