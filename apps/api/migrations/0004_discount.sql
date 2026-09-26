-- Founder / negotiated discount, in percent, applied to the plan price on the Asaas subscription.
alter table subscriptions add column discount_percent integer not null default 0;
