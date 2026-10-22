// UK and India graduate job boards that publish JobPosting data on their job
// pages. Search paths and job URL patterns are the sites' public ones; when a
// site changes them, that source reports "no job links found" and the rest run.
import { jobBoard, unslug } from "./board.mjs";

export const brightNetwork = jobBoard({
  name: "bright-network",
  source: "Bright Network",
  origin: "https://www.brightnetwork.co.uk",
  searches: [{ path: "/search/?content_types=jobs&job_types=internship", type: "internship" }],
  // /graduate-jobs/<company>/<job> and /internships/<company>/<job>
  jobPath: /^\/(?:graduate-jobs|internships)\/([a-z0-9-]+)\/([a-z0-9-]+)$/i,
  fallback(url) {
    const [, , company, role] = url.pathname.split("/");
    return { company: unslug(company), role: unslug(role) };
  },
});

export const prospleUk = jobBoard({
  name: "prosple-uk",
  source: "Prosple",
  origin: "https://uk.prosple.com",
  searches: [{ path: "/search-jobs?opportunity_types=2", type: "internship" }], // 2 = internships
  pageUrl: (search, page) => `https://uk.prosple.com${search.path}${page > 1 ? `&start=${(page - 1) * 20}` : ""}`,
  // /graduate-employers/<company>/jobs-internships/<job>
  jobPath: /^\/graduate-employers\/([a-z0-9-]+)\/jobs-internships\/([a-z0-9-]+)$/i,
  fallback(url) {
    const [, , company, , role] = url.pathname.split("/");
    return { company: unslug(company), role: unslug(role) };
  },
});

export const internshala = jobBoard({
  name: "internshala",
  source: "Internshala",
  origin: "https://internshala.com",
  searches: [
    { path: "/internships/", type: "internship" },
    { path: "/internships/work-from-home-internships/", type: "internship" },
  ],
  pageUrl: (search, page) => `https://internshala.com${search.path}${page > 1 ? `page-${page}/` : ""}`,
  // /internship/detail/<slug ending in the posting id>
  jobPath: /^\/internship\/detail\/[a-z0-9-]+$/i,
  defaultRegion: "India",
});
