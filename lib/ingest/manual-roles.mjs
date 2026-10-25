// Roles added by hand, e.g. from screenshots of LinkedIn that the searches
// didn't find. Each has the best link we could find for it: the company's own
// posting where one is public, else a job-board copy, else the company's
// careers search. Ingested with the main sources every night; a role whose
// deadline has passed is skipped like any other.
export const name = "manual";

/** @type {{ company: string, role: string, location: string, link: string, deadline?: string, added: string }[]} */
export const ROLES = [
  // From LinkedIn screenshots, 25 October 2026.
  { company: "Visa", role: "Product Intern", location: "London",
    link: "https://www.efinancialcareers.co.uk/jobs-UK-London-Product_Intern.id24870348", added: "2026-10-25" },
  { company: "Revolut", role: "Internship Programme 2027: Product Owner (Technical)", location: "United Kingdom (Remote)",
    link: "https://www.revolut.com/careers/position/9bb26c86-9461-4e89-a460-7dc9a067b018", added: "2026-10-25" },
  { company: "Revolut", role: "Internship Programme 2027: Product Owner (UX)", location: "United Kingdom (Remote)",
    link: "https://www.revolut.com/careers/position/d19156aa-506a-4cf5-bea2-2f4c999a1c41", added: "2026-10-25" },
  { company: "IBM", role: "Product Management Intern 2027", location: "Markham, ON, Canada",
    link: "https://www.ibm.com/careers/search?q=product%20manager%20intern%202027", added: "2026-10-25" },
  { company: "Tesco", role: "Technology - Product Management Internship", location: "Welwyn Garden City, UK",
    link: "https://flexa.careers/jobs/tesco-technology-product-management-internship-6ab1e5b0919953e6394b99b1", added: "2026-10-25" },
  { company: "JPMorganChase", role: "2027 Chase Digital Development Programme - Summer Internship (London)", location: "London",
    link: "https://targetjobs.co.uk/jobs/2027-chase-digital-development-programme-summer-internship-247517",
    deadline: "2026-11-01", added: "2026-10-25" },
  { company: "Microsoft", role: "Product Management Intern", location: "London",
    link: "https://jobs.careers.microsoft.com/global/en/search?q=product%20management%20intern&lc=London%2C%20England%2C%20United%20Kingdom",
    added: "2026-10-25" },
  { company: "BNY", role: "2027 BNY Summer Internship Program - Product Management (Manchester)", location: "Manchester",
    link: "https://www.gradcracker.com/hub/1489/bny/work-placement-internship/86223/2027-bny-summer-internship-program-product-management",
    added: "2026-10-25" },
  { company: "Clearwater Analytics", role: "Product Management Intern", location: "London",
    link: "https://www.efinancialcareers.co.uk/jobs-UK-London-Product_Management_Intern.id24802665", added: "2026-10-25" },
  { company: "NCR Atleos", role: "Product Management Internship", location: "Dundee, UK",
    link: "https://targetjobs.co.uk/jobs/product-management-internship-251825", added: "2026-10-25" },
];

/** @param {import("./run.mjs").SourceContext} _ctx */
export async function fetchJobs(_ctx) {
  return ROLES.map((r) => ({
    company: r.company,
    role: r.role,
    type: "internship",
    location: r.location,
    deadline: r.deadline ?? null,
    source: "Added by hand",
    link: r.link,
  }));
}
