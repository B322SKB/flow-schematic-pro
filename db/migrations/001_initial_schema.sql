CREATE TABLE pid_drawings (
  drawing_id UUID PRIMARY KEY,
  current_revision_no INTEGER NOT NULL CHECK (current_revision_no > 0),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pid_drawing_revisions (
  drawing_id UUID NOT NULL REFERENCES pid_drawings(drawing_id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (drawing_id, revision_no)
);

CREATE INDEX pid_drawing_revisions_created_at_idx
  ON pid_drawing_revisions (drawing_id, created_at DESC);
