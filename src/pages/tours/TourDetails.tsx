import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { useAppStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  Clock,
  MapPin,
  Check,
  X,
  Image as ImageIcon,
} from "lucide-react";

export function TourDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tours, fetchTours } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [imageIndex, setImageIndex] = useState(0);
  useEffect(() => {
    let active = true;
    fetchTours().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchTours]);
  const tour = tours.find((t) => t.id === id);
  if (!tour)
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h2 className="text-xl font-semibold">
          {loading ? "Loading package…" : "Package not found"}
        </h2>
        <Button onClick={() => navigate("/tours")}>Back to packages</Button>
      </div>
    );
  const enquiry = () =>
    navigate("/leads", {
      state: { openAdd: true, presetTour: tour.title, presetSource: "Website" },
    });
  const images = tour.images || [];
  const details = [
    ["Departure city", tour.departure_city],
    ["Availability", tour.availability],
    ["Accommodation", tour.accommodation],
    ["Meals", tour.meals],
    ["Transport", tour.transport],
  ];
  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Back to packages"
          onClick={() => navigate("/tours")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{tour.title}</h1>
            <Badge variant="secondary">{tour.status}</Badge>
          </div>
          <p className="flex items-center gap-1 mt-2 text-slate-500">
            <MapPin className="h-4 w-4" />
            {tour.destination}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(`/tours/${tour.id}/edit`)}
          >
            Edit package
          </Button>
          <Button onClick={enquiry}>Create enquiry</Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2 min-w-0">
          <div className="space-y-3">
            <div className="aspect-video rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center">
              {images.length ? (
                <img
                  src={images[imageIndex] || images[0]}
                  alt={tour.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-slate-400 text-center">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2" />
                  <p>Add package photos in Edit package</p>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {images.map((src, i) => (
                  <button
                    key={i}
                    aria-label={`View photo ${i + 1}`}
                    aria-pressed={imageIndex === i}
                    onClick={() => setImageIndex(i)}
                    className={`shrink-0 rounded-lg overflow-hidden border-2 ${imageIndex === i ? "border-teal-600" : "border-transparent"}`}
                  >
                    <img src={src} alt="" className="h-16 w-24 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-3">Package overview</h2>
              <p className="whitespace-pre-wrap text-slate-600 leading-relaxed">
                {tour.description}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">Travel details</h2>
              {tour.duration_note && <p className="text-sm text-amber-800 bg-amber-50 p-3 rounded mb-4">{tour.duration_note} Please confirm with an advisor.</p>}
              {tour.source_url && <a className="text-sm text-teal-700 underline block mb-4" href={tour.source_url} target="_blank" rel="noopener noreferrer">View source catalogue</a>}
              <dl className="grid gap-5 sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm text-slate-500">{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap font-medium text-slate-800">
                      {value || "Not specified"}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">
                Day-by-day itinerary
              </h2>
              {tour.itinerary ? (
                <div
                  className="prose prose-slate max-w-none break-words [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(String(tour.itinerary)),
                  }}
                />
              ) : (
                <p className="text-slate-500">
                  Add the daily activities and travel plan in Edit package.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-3">
                Booking & cancellation terms
              </h2>
              <p className="text-slate-600 whitespace-pre-wrap">
                {tour.cancellation_policy ||
                  "Terms have not been added yet. Confirm them before booking."}
              </p>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6 min-w-0">
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div>
                <p className="text-sm text-slate-500">Price per person</p>
                <p className="text-3xl font-bold mt-1">
                  {tour.price_on_request ? "Quote on request" : new Intl.NumberFormat("en-IE", {
                    style: "currency",
                    currency: "EUR",
                  }).format(Number(tour.price))}
                </p>
              </div>
              <p className="flex items-center gap-2 text-slate-600">
                <Clock className="w-4 h-4" />
                {tour.duration_note ? "Duration to be confirmed" : `${tour.duration} days`}
              </p>
              <Button className="w-full" onClick={enquiry}>
                Create enquiry for this package
              </Button>
              <p className="text-xs text-slate-500">
                Opens a new lead with this package already selected.
              </p>
            </CardContent>
          </Card>
          {(["inclusions", "exclusions"] as const).map((key) => (
            <Card key={key}>
              <CardContent className="pt-6">
                <h2 className="font-semibold mb-4">
                  {key === "inclusions" ? "Included" : "Not included"}
                </h2>
                {tour[key]?.length ? (
                  <ul className="space-y-3">
                    {tour[key]!.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-600">
                        {key === "inclusions" ? (
                          <Check className="h-4 w-4 shrink-0 text-teal-600" />
                        ) : (
                          <X className="h-4 w-4 shrink-0 text-rose-500" />
                        )}
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">
                    Not specified. Add details in Edit package.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
