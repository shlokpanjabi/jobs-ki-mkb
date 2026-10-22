import { redirect } from "next/navigation";

// "Closing in 7 days" is now the Closing soon chip on All roles.
export default function ClosingSoonPage() {
  redirect("/?due=7");
}
