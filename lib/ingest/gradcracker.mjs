// Gradcracker (UK STEM internships and placements). No RSS feed, so this reads
// the public search pages, then each job page (see board.mjs).
import { jobBoard, unslug } from "./board.mjs";
import { UK_REGION } from "./normalise.mjs";

// /hub/<company id>/<company slug>/<opportunity type>/<job id>/<job slug>
const JOB_PATH = /^\/hub\/\d+\/([a-z0-9-]+)\/[a-z0-9-]+\/\d+\/([a-z0-9-]+)$/i;

export const { name, fetchJobs, parseJobPage } = jobBoard({
  name: "gradcracker",
  source: "Gradcracker",
  origin: "https://www.gradcracker.com",
  searches: [
    { path: "/search/all-disciplines/engineering-work-placements-internships", type: "internship" },
    { path: "/search/computing-technology/computer-science-work-placements-internships", type: "internship", domain: "Software" },
  ],
  jobPath: JOB_PATH,
  defaultRegion: UK_REGION,
  fallback(url) {
    const [, company, role] = JOB_PATH.exec(url.pathname) ?? [];
    return { company: unslug(company), role: unslug(role) };
  },
});
