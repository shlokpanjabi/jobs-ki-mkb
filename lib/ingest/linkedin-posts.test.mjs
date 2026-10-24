// Run with `npm test`. No network: the OpenAI client is a fake.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJobs, linkedinLink, parseResponse } from "./linkedin-posts.mjs";

const POST = "https://www.linkedin.com/posts/acme_hiring-interns-activity-7390000000000000000-AbCd";
const JOB = "https://uk.linkedin.com/jobs/view/4300000000";

// A Responses API response: a web_search_call with sources, then a message
// whose JSON lists posts, with url_citation annotations.
function response(posts, { sources = [], cited = [] } = {}) {
  return {
    output: [
      { type: "web_search_call", status: "completed", action: { type: "search", query: "q", sources: sources.map((url) => ({ type: "url", url })) } },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: "```json\n" + JSON.stringify({ posts }) + "\n```",
          annotations: cited.map((url) => ({ type: "url_citation", url, title: "t", start_index: 0, end_index: 1 })),
        }],
      },
    ],
  };
}

test("linkedin posts: only links the search returned, and only posts or jobs", () => {
  assert.equal(linkedinLink(`${POST}/?utm_source=share&trk=x`), POST);
  assert.equal(linkedinLink(JOB), "https://www.linkedin.com/jobs/view/4300000000");
  assert.equal(linkedinLink("https://www.linkedin.com/in/someone"), null); // a profile
  assert.equal(linkedinLink("https://evil.test/posts/x"), null);
  assert.equal(linkedinLink("https://linkedin.com.evil.test/posts/x"), null);

  const jobs = parseResponse(response(
    [
      { company: "Acme", role: "Summer Software Intern 2027", location: "London", deadline: "2026-12-01", link: `${POST}?utm_source=share` },
      { company: "Bolt", role: "Data Intern", location: null, deadline: "soon", link: JOB },
      { company: "Ghost Co", role: "Made-up Intern", location: "London", deadline: null, link: "https://www.linkedin.com/posts/ghost_invented-activity-1" },
      { company: "", role: "No company", location: null, deadline: null, link: POST },
    ],
    { sources: [JOB], cited: [POST] },
  ));
  assert.deepEqual(jobs.map((j) => [j.company, j.role, j.link, j.deadline, j.source]), [
    ["Acme", "Summer Software Intern 2027", POST, "2026-12-01", "LinkedIn post"],
    ["Bolt", "Data Intern", "https://www.linkedin.com/jobs/view/4300000000", null, "LinkedIn post"],
  ]);
  assert.deepEqual(parseResponse({ output: [] }), []);
  assert.deepEqual(parseResponse(response("not a list")), []);
});

test("linkedin posts: searches linkedin.com only, skips quietly without a key, survives a failed search", async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.deepEqual(await fetchJobs({ warn() {} }), []); // not set up
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }

  const bodies = [];
  const warnings = [];
  let n = 0;
  const client = {
    responses: {
      create: async (body) => {
        bodies.push(body);
        if (n++ === 0) throw new Error("rate limited");
        return response([{ company: "Acme", role: "Intern", location: "London", deadline: null, link: POST }], { cited: [POST] });
      },
    },
  };
  const jobs = await fetchJobs({ warn: (m) => warnings.push(m) }, { client, model: "test-model" });
  assert.deepEqual(jobs.map((j) => j.link), [POST]); // the same post from several searches counts once
  assert.equal(warnings.length, 1);
  assert.ok(bodies.every((b) => b.model === "test-model" && b.tools[0].type === "web_search"
    && JSON.stringify(b.tools[0].filters) === JSON.stringify({ allowed_domains: ["linkedin.com"] })
    && b.include.includes("web_search_call.action.sources")));

  const failing = { responses: { create: async () => { throw new Error("down"); } } };
  await assert.rejects(fetchJobs({ warn() {} }, { client: failing }), /no LinkedIn post search succeeded/);
});
