-- Import the visually verified Wallace price sheet. The source heading says
-- "Aerial In-House", but the business instruction classifies these rows as Wallace.

create table if not exists public.production_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_page_count integer not null check (source_page_count > 0),
  source_heading text,
  created_at timestamptz not null default now()
);

create table if not exists public.production_catalog_source_rows (
  source_id uuid not null references public.production_catalog_sources(id) on delete restrict,
  source_row integer not null check (source_row > 0),
  catalog_item_id uuid not null references public.production_code_catalog(id) on delete restrict,
  primary key (source_id, source_row),
  unique (source_id, catalog_item_id)
);

insert into public.production_catalog_sources(
  slug, source_sha256, source_page_count, source_heading
) values (
  'wallace-wr-line-pole-solutions-2026-08-13',
  'edb67a41c7f514ea4175108a96b9919fd2ff9adb16c7c23eae204d43b9b55c90', 1, 'Aerial In-House'
)
on conflict (slug) do nothing;

do $$
begin
  if not exists (
    select 1 from public.production_catalog_sources
    where slug = 'wallace-wr-line-pole-solutions-2026-08-13'
      and source_sha256 = 'edb67a41c7f514ea4175108a96b9919fd2ff9adb16c7c23eae204d43b9b55c90'
      and source_page_count = 1
      and source_heading = 'Aerial In-House'
  ) then raise exception 'Wallace pricing source identity mismatch'; end if;
end;
$$;

create temporary table wallace_import_rows (
  source_row integer primary key,
  code text not null,
  description text not null,
  unit_price numeric(12,3) not null check (unit_price >= 0)
) on commit drop;

insert into wallace_import_rows(source_row, code, description, unit_price)
select "sourceRow", code, description, "unitPrice"
from jsonb_to_recordset('[{"sourceRow":1,"code":"AC01","description":"Coax-Composite New Aerial (minimum job length 1000'')","unitPrice":"0.94"},{"sourceRow":2,"code":"AC01-A","description":"Coax-Composite New Aerial (1''-999'')","unitPrice":"1.02"},{"sourceRow":3,"code":"AC02","description":"Fiber-Composite New Aerial (minimum job length 1000'')","unitPrice":"0.92"},{"sourceRow":4,"code":"AC02-A","description":"Fiber-Composite New Aerial (1''-999'')","unitPrice":"0.99"},{"sourceRow":5,"code":"AC04","description":"Coax-Composite AE Splicing w/ Activation","unitPrice":"0.33"},{"sourceRow":6,"code":"AC05","description":"Coax-Composite Replacement AE De-Relash","unitPrice":"0.94"},{"sourceRow":7,"code":"AS02","description":"Install 1/4\" or 5/16\" support system messenger","unitPrice":"0.27"},{"sourceRow":8,"code":"AS03","description":"Lash Coax to New Strand (minimum job length 1000'')","unitPrice":"0.27"},{"sourceRow":9,"code":"AS03-A","description":"Lash Coax to New Strand (1''-999'')","unitPrice":"0.29"},{"sourceRow":10,"code":"AS04","description":"Lash Fiber to New Strand (minimum job length 1000'')","unitPrice":"0.32"},{"sourceRow":11,"code":"AS04-A","description":"Lash Fiber to New Strand (1''-999'')","unitPrice":"0.34"},{"sourceRow":12,"code":"AS05","description":"Lash/Overlash Additional Coax Cable","unitPrice":"0.08"},{"sourceRow":13,"code":"AS06","description":"Overlash Coax Cable (minimum job length 1000'')","unitPrice":"0.28"},{"sourceRow":14,"code":"AS06-A","description":"Overlash Coax Cable (1''-999'')","unitPrice":"0.31"},{"sourceRow":15,"code":"AS07","description":"Overlash Fiber Cable (minimum job length 1000'')","unitPrice":"0.35"},{"sourceRow":16,"code":"AS07-A","description":"Overlash Fiber Cable (1''-999'')","unitPrice":"0.40"},{"sourceRow":17,"code":"AS08","description":"Each additional fiber cable","unitPrice":"0.11"},{"sourceRow":18,"code":"AS09","description":"Install/Remove Anchor (6\" Or 8\")","unitPrice":"23.50"},{"sourceRow":19,"code":"AS12","description":"Pole Transfer (Single Frame, Including Bonds Up To 4 Drops Reworked At Pole)","unitPrice":"44.65"},{"sourceRow":20,"code":"AS12","description":"Pole Transfer (Double Frame, Including Bonds Up To 4 Drops Reworked At Pole)","unitPrice":"44.65"},{"sourceRow":21,"code":"AS13","description":"Move or Rework Riser Up To 10'' Trench (Per Pole)","unitPrice":"44.65"},{"sourceRow":22,"code":"AS14","description":"Install New Riser and/or Guard","unitPrice":"23.50"},{"sourceRow":23,"code":"AS18","description":"Concrete Pole Banding or Tree Guard Per Attachment (per pole)","unitPrice":"32.90"},{"sourceRow":24,"code":"AS18","description":"Install/Remove Downguy Sidewalk Guy or Guy Guard (1/4\" Or 5/16\")","unitPrice":"32.90"},{"sourceRow":25,"code":"AS18","description":"Install/ Replace Fiber Loop Guard, Wagon Wheel, or Extension Arm","unitPrice":"32.90"},{"sourceRow":26,"code":"AS18","description":"Install Ground Rod And Vertical","unitPrice":"32.90"},{"sourceRow":27,"code":"AS18","description":"Install Vertical Bond (#6 Copper To Power Vertical)(Separate Trip)","unitPrice":"32.90"},{"sourceRow":28,"code":"AS18","description":"Install Continuity Bond or Re-Route Drops","unitPrice":"32.90"},{"sourceRow":29,"code":"AS18","description":"Change pole attachment height or Framing Hardware","unitPrice":"32.90"},{"sourceRow":30,"code":"AS18","description":"Resag Existing Coax or Fiber","unitPrice":"32.90"},{"sourceRow":31,"code":"AS18","description":"Rework Drops At Pole During Transfers (5Th Drop And Above, Per Pole)","unitPrice":"32.90"},{"sourceRow":32,"code":"AS19","description":"Partial Wreck Out","unitPrice":"0.09"},{"sourceRow":33,"code":"AS20","description":"Wreck Out- All Strand and Cable","unitPrice":"0.13"},{"sourceRow":34,"code":"AS24","description":"Lash or Delash/Relash fiber cable splice point","unitPrice":"45.00"},{"sourceRow":35,"code":"AS26","description":"Top Pole (Incl. Removal Of Topped Section Of Pole)","unitPrice":"18.80"},{"sourceRow":36,"code":"AS27","description":"Delash/relash fiber cable (up to 2 sheaths of fiber cable)","unitPrice":"0.19"},{"sourceRow":37,"code":"ER01","description":"Trip Charge - Emergency Call out - Per event","unitPrice":"100.00"},{"sourceRow":38,"code":"ER02","description":"Trip Charge - 2man crew per hour","unitPrice":"94.00"},{"sourceRow":39,"code":"ER06","description":"Emergency Ground Hand or General Laborer","unitPrice":"25.85"},{"sourceRow":40,"code":"FS13","description":"Optimize Node/OLT","unitPrice":"94.00"},{"sourceRow":41,"code":"MC01","description":"Install Node - Active - Connector Only","unitPrice":"100.00"},{"sourceRow":42,"code":"MC02","description":"Install Single, Dual, Triple, or Quad Amplifier - Active","unitPrice":"65.80"},{"sourceRow":43,"code":"MC03","description":"Install DC, Power Inserter, or line splitting device - Passive","unitPrice":"21.15"},{"sourceRow":44,"code":"MC03","description":"Aerial/Buried Stab (install new cable into existing device) Passive","unitPrice":"21.15"},{"sourceRow":45,"code":"MC03-A","description":"Change out face plate- Passive","unitPrice":"9.40"},{"sourceRow":46,"code":"MC04","description":"Tree Trimming","unitPrice":"35.25"},{"sourceRow":47,"code":"MC09","description":"Service Method or Procedure (SMOP) Work","unitPrice":"25.00"},{"sourceRow":48,"code":"MC10","description":"Set-Up Fee","unitPrice":"37.60"},{"sourceRow":49,"code":"MC12","description":"Install WIFI Access Points","unitPrice":"65.80"},{"sourceRow":50,"code":"MC17","description":"Rebalance Existing Coax Plant","unitPrice":"28.20"},{"sourceRow":51,"code":"US23","description":"Wreck Out Ground Mount Power Supply","unitPrice":"68.15"},{"sourceRow":52,"code":"UC11","description":"Composite UG Splicing with Activation","unitPrice":"0.33"},{"sourceRow":53,"code":"US05","description":"Place additional cable in empty duct","unitPrice":"0.31"},{"sourceRow":54,"code":"US06","description":"Place additional cable in occupied duct","unitPrice":"0.47"},{"sourceRow":55,"code":"US11","description":"Any Small Tap, Coupler, or Vertical Vault/Ped","unitPrice":"18.80"},{"sourceRow":56,"code":"US12","description":"Install Vault up to 18\"x30\" OR Horizontal Ped up to 18\"x36","unitPrice":"35.25"},{"sourceRow":57,"code":"US26","description":"Re-power coax plant","unitPrice":"23.50"},{"sourceRow":58,"code":"US28","description":"Proof and Place Pull Rope- Occupied Conduit","unitPrice":"0.33"},{"sourceRow":59,"code":"US28-A","description":"Proof and Place Pull Rope- Empty Conduit","unitPrice":"0.12"}]'::jsonb)
  as row("sourceRow" integer, code text, description text, "unitPrice" numeric);

do $$
declare
  wallace_source_id uuid;
  wallace_category_id uuid;
  persisted_rows integer;
  persisted_rates integer;
begin
  select id into wallace_source_id
  from public.production_catalog_sources
  where slug = 'wallace-wr-line-pole-solutions-2026-08-13';
  select id into wallace_category_id from public.price_categories where slug = 'wallace';

  select count(*) into persisted_rows
  from public.production_catalog_source_rows
  where source_id = wallace_source_id;

  select count(*) into persisted_rates
  from public.production_code_rates
  where price_category_id = wallace_category_id
    and effective_from = date '2026-08-13'
    and active;

  if persisted_rows = 0 and persisted_rates > 0 then
    raise exception 'Wallace pricing date already contains rates without verified source mappings';
  end if;

  if persisted_rows > 0 and (
    persisted_rows <> (select count(*) from wallace_import_rows)
    or persisted_rates <> (select count(*) from wallace_import_rows)
    or exists (
      select 1
      from wallace_import_rows w
      where not exists (
        select 1
        from public.production_catalog_source_rows sr
        join public.production_code_catalog c on c.id = sr.catalog_item_id
        join public.production_code_rates r on r.catalog_item_id = c.id
        join public.price_categories pc on pc.id = r.price_category_id
        where sr.source_id = wallace_source_id
          and sr.source_row = w.source_row
          and c.code = w.code
          and c.description = w.description
          and pc.slug = 'wallace'
          and r.effective_from = date '2026-08-13'
          and r.active
          and r.unit_price = w.unit_price
      )
    )
  ) then
    raise exception 'Wallace persisted pricing rows do not match the verified source';
  end if;
end;
$$;

insert into public.production_code_catalog(
  code, description, unit, in_house_rate, contractor_rate, sort_order
)
select w.code, w.description,
  coalesce((
    select c.unit from public.production_code_catalog c
    where c.code = w.code order by c.sort_order, c.id limit 1
  ), 'fixed'),
  0.000, 0.000, 20000 + w.source_row
from wallace_import_rows w
on conflict (code, description) do update set
  is_active = true,
  updated_at = now();

insert into public.production_catalog_source_rows(source_id, source_row, catalog_item_id)
select s.id, w.source_row, c.id
from wallace_import_rows w
join public.production_code_catalog c
  on c.code = w.code and c.description = w.description
join public.production_catalog_sources s
  on s.slug = 'wallace-wr-line-pole-solutions-2026-08-13'
on conflict (source_id, source_row) do update set
  catalog_item_id = excluded.catalog_item_id;

insert into public.production_code_rates(
  catalog_item_id, price_category_id, unit_price, effective_from
)
select c.id, pc.id, w.unit_price, date '2026-08-13'
from wallace_import_rows w
join public.production_code_catalog c
  on c.code = w.code and c.description = w.description
join public.price_categories pc on pc.slug = 'wallace'
on conflict (catalog_item_id, price_category_id, effective_from) do update set
  unit_price = excluded.unit_price,
  active = true,
  updated_at = now();

do $$
declare
  wallace_source_id uuid;
  wallace_category_id uuid;
begin
  select id into wallace_source_id
  from public.production_catalog_sources
  where slug = 'wallace-wr-line-pole-solutions-2026-08-13';
  select id into wallace_category_id from public.price_categories where slug = 'wallace';

  if (select count(*) from wallace_import_rows) <> 59
    or (select count(*) from public.production_catalog_source_rows where source_id = wallace_source_id) <> 59
    or (
      select count(*) from public.production_code_rates
      where price_category_id = wallace_category_id
        and effective_from = date '2026-08-13'
        and active
    ) <> 59
    or exists (
      select 1
      from public.production_code_rates r
      where r.price_category_id = wallace_category_id
        and r.effective_from = date '2026-08-13'
        and r.active
        and not exists (
          select 1
          from public.production_catalog_source_rows sr
          join wallace_import_rows w on w.source_row = sr.source_row
          where sr.source_id = wallace_source_id
            and sr.catalog_item_id = r.catalog_item_id
            and r.unit_price = w.unit_price
        )
    )
    or exists (
      select 1
      from wallace_import_rows w
      where not exists (
        select 1
        from public.production_catalog_source_rows sr
        join public.production_code_catalog c on c.id = sr.catalog_item_id
        join public.production_code_rates r on r.catalog_item_id = c.id
        join public.price_categories pc on pc.id = r.price_category_id
        where sr.source_id = wallace_source_id
          and sr.source_row = w.source_row
          and c.code = w.code
          and c.description = w.description
          and pc.slug = 'wallace'
          and r.effective_from = date '2026-08-13'
          and r.active
          and r.unit_price = w.unit_price
      )
    )
  then raise exception 'Wallace pricing import set validation failed'; end if;
end;
$$;

alter table public.production_catalog_sources enable row level security;
alter table public.production_catalog_source_rows enable row level security;
create policy "Office staff can view catalog sources"
on public.production_catalog_sources for select to authenticated
using (public.is_office_staff());
create policy "Office staff can view catalog source rows"
on public.production_catalog_source_rows for select to authenticated
using (public.is_office_staff());
revoke insert, update, delete on public.production_catalog_sources from authenticated;
revoke insert, update, delete on public.production_catalog_source_rows from authenticated;
grant select on public.production_catalog_sources to authenticated;
grant select on public.production_catalog_source_rows to authenticated;
