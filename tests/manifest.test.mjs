// Tests for lib/manifest.mjs + lib/inventory.mjs: the preflight core.
//
// Every rule here is the pi-link team manifest contract (validated by
// pi-link --team-check in the source family), restated as this kit's own
// executable tests: version, team fields, hub, profile, per-role path
// rules, the cwd-vs-sessionDir rule, linkName and sessionDir uniqueness,
// and skill references. Each test pins one observable error or warning.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultManifestPath, loadManifest } from "../lib/manifest.mjs";
import { profileFrontmatter } from "../lib/inventory.mjs";

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "awt-manifest-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// Write `body` at `rel`, creating parent dirs. `body` may be a string or a
// JSON object (serialized compact).
async function put(root, rel, body) {
  await mkdir(join(root, rel, ".."), { recursive: true });
  await writeFile(join(root, rel), typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
}

// A valid single-role manifest, overridable field by field. `null` removes
// a top-level key (use `roles: null` to remove roles entirely).
function teamJson(overrides = {}) {
  const manifest = {
    version: 1,
    team: { name: "demo", group: "demo" },
    hub: { role: "planner", mode: "designated" },
    roles: {
      planner: { profile: ".pi-link/profiles/planner.md", cwd: "." },
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete manifest[key];
    else manifest[key] = value;
  }
  return manifest;
}

// A valid world: manifest + one profile on disk; cwd "." is the root, so it
// always exists.
async function worldWith(manifestBody, extraFiles = []) {
  const { root, cleanup } = await sandbox();
  await put(root, ".pi-link/team.json", manifestBody);
  for (const [rel, body] of extraFiles) {
    await put(root, rel, body ?? "content\n");
  }
  return { root, manifestPath: defaultManifestPath(root), cleanup };
}

const PLANNER_PROFILE = [".pi-link/profiles/planner.md", "---\nname: planner\n---\nbody\n"];

const PLANNER_ONLY = [PLANNER_PROFILE];

test("missing manifest file is one clean error", async () => {
  const { root, cleanup } = await sandbox();
  try {
    const manifestPath = defaultManifestPath(root);
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, [`no team manifest at ${manifestPath}`]);
  } finally {
    cleanup();
  }
});

test("malformed JSON is one clean error, no stack trace", async () => {
  const { root, manifestPath, cleanup } = await sandbox();
  try {
    await put(root, ".pi-link/team.json", "{ version: 1, ");
    const result = await loadManifest(root, manifestPath);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^team manifest is not valid JSON: /);
  } finally {
    cleanup();
  }
});

test("version is required to be 1", async () => {
  for (const [label, mutate] of [
    ["missing", (m) => delete m.version],
    ["wrong number", (m) => (m.version = 2)],
  ]) {
    const manifest = teamJson({});
    mutate(manifest);
    const { root, manifestPath, cleanup } = await worldWith(manifest, PLANNER_ONLY);
    try {
      const result = await loadManifest(root, manifestPath);
      assert.ok(
        result.errors.includes("team manifest version must be 1"),
        `${label}: ${result.errors}`,
      );
    } finally {
      cleanup();
    }
  }
});

test("a valid manifest loads with zero errors and zero warnings", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson(), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.config.team.name, "demo");
  } finally {
    cleanup();
  }
});

test("team.name is required", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ team: { group: "demo" } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(result.errors.includes("team.name is required"), `${result.errors}`);
  } finally {
    cleanup();
  }
});

test("team.group is required", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ team: { name: "demo" } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(result.errors.includes("team.group is required"), `${result.errors}`);
  } finally {
    cleanup();
  }
});

test("roles must contain at least one role", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: {} }), []);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(result.errors.includes("roles must contain at least one role"), `${result.errors}`);
  } finally {
    cleanup();
  }
});

test("hub.role is required", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ hub: null }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(result.errors.includes("hub.role is required"), `${result.errors}`);
  } finally {
    cleanup();
  }
});

test("hub.role must name a configured role", async () => {
  const { root, manifestPath, cleanup } = await worldWith(
    teamJson({ hub: { role: "ghost", mode: "designated" } }),
    PLANNER_ONLY,
  );
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes('hub.role "ghost" does not name a configured role'),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("profile is required per role", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: { cwd: "." } } }), []);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(result.errors.includes("roles.planner.profile is required"), `${result.errors}`);
  } finally {
    cleanup();
  }
});

test("missing profile file is an error naming the path", async () => {
  const { root, manifestPath, cleanup } = await worldWith(
    teamJson({ roles: { planner: { profile: ".pi-link/profiles/nope.md", cwd: "." } } }),
    [],
  );
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.planner.profile is missing: .pi-link/profiles/nope.md"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

const PATH_FIELDS = ["profile", "prompt", "config", "cwd", "sessionDir"];
for (const field of PATH_FIELDS) {
  test(`absolute ${field} path is an error`, async () => {
    const role = { profile: ".pi-link/profiles/planner.md", cwd: "." };
    role[field] = "/etc/passwd";
    const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
    try {
      const result = await loadManifest(root, manifestPath);
      assert.ok(
        result.errors.some((line) =>
          line.startsWith(`roles.planner.${field} must be a repo-relative path: `),
        ),
        `${result.errors}`,
      );
    } finally {
      cleanup();
    }
  });
}

test("declared prompt that does not exist is an error", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", prompt: ".pi-link/prompts/planner.md" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.planner.prompt is missing: .pi-link/prompts/planner.md"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("declared config that does not exist is an error", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", config: ".pi-link/session.yml" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.planner.config is missing: .pi-link/session.yml"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("declared prompt that exists is fine", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", prompt: ".pi-link/prompts/planner.md" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), [
    ...PLANNER_ONLY,
    [".pi-link/prompts/planner.md", "prompt text\n"],
  ]);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
  } finally {
    cleanup();
  }
});

test("cwd that is not an existing directory is an error", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: "workspaces/planner" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.planner.cwd is not an existing directory: workspaces/planner"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("sessionDir that does not exist is only a warning on a fresh checkout", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", sessionDir: ".pi-link/sessions/planner" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.warnings.includes(
        "roles.planner.sessionDir does not exist yet (created on first launch): .pi-link/sessions/planner",
      ),
      `${result.warnings}`,
    );
  } finally {
    cleanup();
  }
});

test("sessionDir that exists fires no warning", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", sessionDir: ".pi-link/sessions/planner" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), [
    ...PLANNER_ONLY,
    [".pi-link/sessions/planner/.keep", ""],
  ]);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanup();
  }
});

test("duplicate linkName across roles is an error", async () => {
  const roles = {
    planner: { profile: ".pi-link/profiles/planner.md", cwd: ".", linkName: "shared" },
    builder: { profile: ".pi-link/profiles/builder.md", cwd: ".", linkName: "shared" },
  };
  const files = [
    PLANNER_PROFILE,
    [".pi-link/profiles/builder.md", "---\nname: builder\n---\nbody\n"],
  ];
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles }), files);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.builder.linkName duplicates roles.planner: shared"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("shared sessionDir across roles is an error", async () => {
  const roles = {
    planner: { profile: ".pi-link/profiles/planner.md", cwd: ".", sessionDir: ".pi-link/sessions/one" },
    builder: { profile: ".pi-link/profiles/builder.md", cwd: ".", sessionDir: ".pi-link/sessions/one" },
  };
  const files = [
    PLANNER_PROFILE,
    [".pi-link/profiles/builder.md", "---\nname: builder\n---\nbody\n"],
    [".pi-link/sessions/one/.keep", ""],
  ];
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles }), files);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes(
        "roles.builder.sessionDir is shared with roles.planner: .pi-link/sessions/one",
      ),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("required skill that is missing is an error", async () => {
  const role = {
    profile: ".pi-link/profiles/planner.md",
    cwd: ".",
    skills: { required: ["team-workflow"] },
  };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.includes("roles.planner.skills.required references missing skill: team-workflow"),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("optional skill that is missing is only a warning", async () => {
  const role = {
    profile: ".pi-link/profiles/planner.md",
    cwd: ".",
    skills: { optional: ["browser-tools"] },
  };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.warnings.includes("roles.planner.skills.optional references missing skill: browser-tools"),
      `${result.warnings}`,
    );
  } finally {
    cleanup();
  }
});

test("required skill present in a skill root is fine", async () => {
  const role = {
    profile: ".pi-link/profiles/planner.md",
    cwd: ".",
    skills: { required: ["team-workflow"] },
  };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), [
    ...PLANNER_ONLY,
    ["skills/team-workflow/SKILL.md", "# Team Workflow\n"],
  ]);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanup();
  }
});

test("the same skill id in two roots fires the shadow warning", async () => {
  const { root, manifestPath, cleanup } = await worldWith(teamJson(), [
    ...PLANNER_ONLY,
    ["skills/team-workflow/SKILL.md", "# Team Workflow\n"],
    [".agents/skills/team-workflow/SKILL.md", "# Team Workflow\n"],
  ]);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    const shadow = result.warnings.find(
      (line) => line.startsWith('skill "team-workflow" appears in 2 skill roots'),
    );
    assert.ok(shadow, `${result.warnings}`);
  } finally {
    cleanup();
  }
});

test("tools as an object of string arrays is valid", async () => {
  const role = {
    profile: ".pi-link/profiles/planner.md",
    cwd: ".",
    tools: { required: ["read", "link_list", "link_send"], requestable: ["browser"] },
  };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
  } finally {
    cleanup();
  }
});

test("malformed tools shape is an error", async () => {
  const role = { profile: ".pi-link/profiles/planner.md", cwd: ".", tools: "read" };
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), PLANNER_ONLY);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.ok(
      result.errors.some((line) =>
        line.startsWith("roles.planner.tools must be an object whose values are arrays of strings:"),
      ),
      `${result.errors}`,
    );
  } finally {
    cleanup();
  }
});

test("manifest model overriding the profile's declared model fires the override warning", async () => {
  const role = {
    profile: ".pi-link/profiles/planner-with-model.md",
    cwd: ".",
    model: "example-model-large",
  };
  const files = [
    [".pi-link/profiles/planner-with-model.md", "---\nname: planner\nmodel: example-model-small\n---\nbody\n"],
  ];
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), files);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.warnings.includes(
        'roles.planner.model "example-model-large" overrides the profile\'s declared "example-model-small", so the manifest value is what launches',
      ),
      `${result.warnings}`,
    );
  } finally {
    cleanup();
  }
});

test("matching manifest and profile models fire no warning", async () => {
  const role = {
    profile: ".pi-link/profiles/planner-with-model.md",
    cwd: ".",
    model: "example-model-small",
  };
  const files = [
    [".pi-link/profiles/planner-with-model.md", "---\nname: planner\nmodel: example-model-small\n---\nbody\n"],
  ];
  const { root, manifestPath, cleanup } = await worldWith(teamJson({ roles: { planner: role } }), files);
  try {
    const result = await loadManifest(root, manifestPath);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanup();
  }
});

test("profileFrontmatter reads scalars by hand", async () => {
  const { root, cleanup } = await sandbox();
  try {
    const file = join(root, "profile.md");
    await put(root, "profile.md", "---\nname: planner\nrole: Coordinator\nmodel: example-model-small\nlinkName: planner\n---\nbody\n");
    const fm = profileFrontmatter(file);
    assert.equal(fm.role, "Coordinator");
    assert.equal(fm.model, "example-model-small");
    assert.equal(fm.linkName, "planner");
  } finally {
    cleanup();
  }
});

test("profileFrontmatter reads a quoted one-line description", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, "profile.md", '---\nname: planner\ndescription: "Coordinates the lanes"\n---\nbody\n');
    const fm = profileFrontmatter(join(root, "profile.md"));
    assert.equal(fm.description, "Coordinates the lanes");
  } finally {
    cleanup();
  }
});

test("profileFrontmatter on a file without frontmatter returns nulls", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await put(root, "profile.md", "no frontmatter here\n");
    const fm = profileFrontmatter(join(root, "profile.md"));
    assert.equal(fm.model, null);
    assert.equal(fm.role, null);
  } finally {
    cleanup();
  }
});