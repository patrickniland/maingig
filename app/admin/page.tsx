import { supabase } from "@/lib/supabase";
import { toggleJobActiveAction, recordPlacementAction } from "./actions";

type Listing = {
  id: string;
  title: string;
  location_area: string | null;
  employment_type: string | null;
  active: boolean;
  posted_at: string;
  employers: {
    business_name: string;
    contact_name: string | null;
    contact_phone: string | null;
  } | null;
};

type SeekingUser = {
  id: string;
  phone_number: string;
  full_name: string | null;
  status: string;
  created_at: string;
};

async function getListings(): Promise<Listing[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, location_area, employment_type, active, posted_at, employers(business_name, contact_name, contact_phone)")
    .eq("source", "informal")
    .gte("posted_at", since)
    .order("posted_at", { ascending: false });
  return (data ?? []) as unknown as Listing[];
}

async function getUsers(): Promise<SeekingUser[]> {
  const { data } = await supabase
    .from("users")
    .select("id, phone_number, full_name, status, created_at")
    .in("status", ["seeking", "placed"])
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as SeekingUser[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  const params = await searchParams;

  if (params.secret !== process.env.DASHBOARD_SECRET_TOKEN) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">Access denied.</p>
      </div>
    );
  }

  const [listings, users] = await Promise.all([getListings(), getUsers()]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">MainGig Admin</h1>
      <p className="text-sm text-gray-500 mb-8">Listing review · Placement recording</p>

      {/* Informal listings */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Informal listings — last 14 days ({listings.length})
        </h2>

        {listings.length === 0 ? (
          <p className="text-sm text-gray-400">No listings yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Title</th>
                  <th className="px-4 py-3 text-left">Employer</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-left">Posted</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listings.map((listing) => (
                  <tr key={listing.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{listing.title}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {listing.employers?.business_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {listing.employers?.contact_name && (
                        <span className="block">{listing.employers.contact_name}</span>
                      )}
                      {listing.employers?.contact_phone && (
                        <a
                          href={`tel:${listing.employers.contact_phone}`}
                          className="text-green-700 hover:underline"
                        >
                          {listing.employers.contact_phone}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{listing.location_area ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(listing.posted_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          listing.active
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {listing.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <form action={toggleJobActiveAction}>
                        <input type="hidden" name="jobId" value={listing.id} />
                        <input type="hidden" name="active" value={listing.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
                            listing.active
                              ? "bg-red-50 text-red-700 hover:bg-red-100"
                              : "bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {listing.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Job seekers ({users.length})
        </h2>

        {users.length === 0 ? (
          <p className="text-sm text-gray-400">No users yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Joined</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.phone_number}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          u.status === "placed"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(u.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {u.status !== "placed" && (
                        <form action={recordPlacementAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button
                            type="submit"
                            className="rounded px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer"
                          >
                            Mark placed
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
