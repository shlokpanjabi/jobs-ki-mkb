-- Sample data with fictional companies and example.com links.
-- Deadlines are relative to today so the "closing in 7 days" view always has rows.
-- Re-running is a no-op for jobs that already exist (deduped on link).
-- Per-user columns: a status means that user is eligible; null means not eligible.

with seed (company, role, type, domain, location, region, days_left, source, link, taran, shlok, muzzamil) as (
  values
    ('Northwind Labs',      'Software Engineering Intern',     'internship', 'Software',       'San Francisco, CA', 'US',     3,    'LinkedIn',        'https://example.com/jobs/northwind-swe-intern',     'todo',     'applied',  'todo'),
    ('Lumen Health',        'Data Science Intern',             'internship', 'Data',           'Boston, MA',        'US',     6,    'Handshake',       'https://example.com/jobs/lumen-data-intern',        'todo',     null,       'todo'),
    ('Fernbrook Capital',   'Quant Research Intern',           'internship', 'Finance',        'New York, NY',      'US',     12,   'Company site',    'https://example.com/jobs/fernbrook-quant-intern',   null,       'todo',     null),
    ('Atlas Climate',       'Climate Policy Fellow',           'fellowship', 'Policy',         'Remote',            'Remote', 20,   'Newsletter',      'https://example.com/jobs/atlas-policy-fellow',      'todo',     'todo',     'todo'),
    ('Kestrel Robotics',    'Embedded Systems Intern',         'internship', 'Hardware',       'Bengaluru',         'India',  2,    'LinkedIn',        'https://example.com/jobs/kestrel-embedded-intern',  null,       'todo',     'todo'),
    ('Bluebird Books',      'Marketing Assistant',             'part-time',  'Marketing',      'London',            'Europe', 9,    'Indeed',          'https://example.com/jobs/bluebird-marketing-pt',    'applied',  null,       null),
    ('Quill AI',            'ML Engineering Intern',           'internship', 'AI/ML',          'Remote',            'Remote', 5,    'X',               'https://example.com/jobs/quill-ml-intern',          'rejected', 'todo',     'applied'),
    ('Harbor',              'Founders Fellowship',             'fellowship', 'Entrepreneurship','San Francisco, CA','US',     30,   'Referral',        'https://example.com/jobs/harbor-founders-fellow',   'todo',     'todo',     null),
    ('Meridian Bank',       'Summer Analyst',                  'internship', 'Finance',        'London',            'Europe', -2,   'Company site',    'https://example.com/jobs/meridian-summer-analyst',  'rejected', 'applied',  null),
    ('Copperleaf Studio',   'Frontend Developer',              'part-time',  'Software',       'Remote',            'Remote', null, 'Wellfound',       'https://example.com/jobs/copperleaf-frontend-pt',   null,       'todo',     'todo'),
    ('Tidepool Research',   'Ocean Data Research Fellow',      'fellowship', 'Research',       'Lisbon',            'Europe', 45,   'University board','https://example.com/jobs/tidepool-research-fellow', null,       null,       'todo'),
    ('Orbital Ventures',    'Venture Fellow',                  'fellowship', 'Venture Capital','New York, NY',      'US',     7,    'LinkedIn',        'https://example.com/jobs/orbital-venture-fellow',   'todo',     'todo',     null),
    ('Cobalt Security',     'Security Engineering Intern',     'internship', 'Security',       'Toronto',           'Canada', 14,   'Handshake',       'https://example.com/jobs/cobalt-security-intern',   null,       'offer',    'todo'),
    ('Pine & Co',           'Research Assistant',              'part-time',  'Research',       'Mumbai',            'India',  4,    'WhatsApp group',  'https://example.com/jobs/pine-research-assistant',  'todo',     null,       'todo'),
    ('Granite Systems',     'Product Management Intern',       'internship', 'Product',        'Seattle, WA',       'US',     1,    'Company site',    'https://example.com/jobs/granite-pm-intern',        'todo',     'todo',     'todo'),
    ('Sunline Energy',      'Hardware Engineering Intern',     'internship', 'Hardware',       'Austin, TX',        'US',     25,   'Indeed',          'https://example.com/jobs/sunline-hardware-intern',  null,       null,       'todo')
),
inserted as (
  insert into jobs (company, role, type, domain, location, region, deadline, source, link)
  select company, role, type, domain, location, region, current_date + days_left, source, link
  from seed
  on conflict (link) do nothing
  returning id, link
)
insert into user_jobs (job_id, user_id, status)
select inserted.id, per_user.user_id, per_user.status
from inserted
join seed using (link)
cross join lateral (
  values ('taran', seed.taran), ('shlok', seed.shlok), ('muzzamil', seed.muzzamil)
) as per_user (user_id, status)
where per_user.status is not null
on conflict do nothing;
