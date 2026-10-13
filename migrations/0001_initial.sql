-- Cloudflare D1 private bidding workspace, apply manually to private database.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  contact_name TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('agency','supplier','prime','consultant','other')),
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  relationship_status TEXT NOT NULL DEFAULT 'new' CHECK(relationship_status IN ('new','researching','introduced','engaged','priority')),
  notes TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  last_contacted_on TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS bid_opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agency TEXT NOT NULL DEFAULT '',
  venture TEXT NOT NULL DEFAULT 'Other',
  source_url TEXT NOT NULL DEFAULT '',
  close_date TEXT NOT NULL DEFAULT '',
  estimated_value TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'watching' CHECK(stage IN ('watching','qualifying','pursuing','submitted','won','lost')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  owner TEXT NOT NULL DEFAULT '',
  win_theme TEXT NOT NULL DEFAULT '',
  bid_strategy TEXT NOT NULL DEFAULT '',
  eligibility_notes TEXT NOT NULL DEFAULT '',
  pricing_notes TEXT NOT NULL DEFAULT '',
  competitor_notes TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  related_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS bid_tasks (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES bid_opportunities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done')),
  assigned_to TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization);
CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts(updated_at);
CREATE INDEX IF NOT EXISTS idx_bids_stage_close ON bid_opportunities(stage,close_date);
CREATE INDEX IF NOT EXISTS idx_bids_venture ON bid_opportunities(venture);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON bid_tasks(status,due_date);
