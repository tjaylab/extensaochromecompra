-- Demo companies (Chrome Web Store reviewers, sales demos): Omie is simulated for them, the rest is real.
alter table companies add column demo boolean not null default false;
