export const PACKAGE_TYPES = [
  'domestic', 'international', 'fit', 'group', 'honeymoon',
  'corporate', 'pilgrimage', 'educational', 'luxury', 'adventure', 'cruise', 'custom',
] as const;

export const TAX_TYPES = ['GST 5%', 'GST 12%', 'GST 18%', 'No Tax'] as const;
export const CURRENCIES = ['INR', 'AED', 'USD'] as const;
export const LANGUAGES = ['English', 'Tamil', 'Hindi', 'Telugu', 'Malayalam'] as const;
export const MEAL_PLANS = ['EP', 'CP', 'MAP', 'AP', 'All Inclusive'] as const;
export const STAR_CATEGORIES = ['Budget', 'Boutique', '3 Star', '4 Star', '5 Star'] as const;
export const VEHICLE_TYPES = ['Car', 'SUV', 'Bus', 'Mini Van', 'Tempo Traveller'] as const;
export const FLIGHT_CLASSES = ['Economy', 'Business', 'First'] as const;
export const OPTION_LABELS = ['OPT 1', 'OPT 2', 'OPT 3'] as const;
export const OCCUPANCY_TYPES = ['Single', 'Double', 'Triple'] as const;

export const DEFAULT_CANCELLATION = `30+ days before travel: Full refund minus service fee
15-29 days before travel: 40-60% refund
7-14 days before travel: Up to 20% refund
Less than 7 days: No refund
No show: No refund
Force majeure: Credit voucher valid 12 months`;

export const DEFAULT_REFUND = `Refunds are processed within 7-14 business days.
Refunds are credited to the original payment method.
Processing fees are non-refundable.`;

export const DEFAULT_TERMS = `1. All bookings are subject to availability.
2. Prices are per person unless stated otherwise.
3. We reserve the right to modify itineraries due to unforeseen circumstances.
4. Valid passport required for all international travel (minimum 6 months validity).
5. Travel insurance is strongly recommended.
6. Hotel check-in/check-out times apply.`;

export function getTaxRate(taxType: string): number {
  if (taxType === 'GST 5%') return 0.05;
  if (taxType === 'GST 12%') return 0.12;
  if (taxType === 'GST 18%') return 0.18;
  return 0;
}

export interface PackageStop {
  id: string;
  time: string;
  place_name: string;
  description: string;
  image_url: string;
}

export interface ItineraryDayForm {
  id?: string;
  day_number: number;
  title: string;
  description: string;
  date: string;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean; all_inclusive: boolean };
  stops: PackageStop[];
}

export interface HotelForm {
  id?: string;
  option_label: string;
  hotel_name: string;
  star_category: string;
  location: string;
  checkin_date: string;
  checkout_date: string;
  rooms: number;
  meal_plan: string;
  room_category: string;
  room_occupancy: string;
  notes: string;
}

export interface FlightForm {
  id?: string;
  flight_no: string;
  airline: string;
  class: string;
  from_city: string;
  from_datetime: string;
  to_city: string;
  to_datetime: string;
  notes: string;
}

export interface TransferForm {
  id?: string;
  transfer_name: string;
  vehicle_type: string;
  from_location: string;
  to_location: string;
  transfer_datetime: string;
  notes: string;
}

export interface PackageFormData {
  name: string;
  package_code: string;
  type: string;
  destinations: string[];
  duration_days: number;
  duration_nights: number;
  start_date: string;
  end_date: string;
  max_pax: string;
  language: string;
  is_active: boolean;
  is_template: boolean;
  description: string;
  highlights: string;

  itinerary: ItineraryDayForm[];
  hotels: HotelForm[];
  flights: FlightForm[];
  transfers: TransferForm[];

  net_price: string;
  base_price_adult: string;
  base_price_child: string;
  price_child_nobed: string;
  price_infant: string;
  price_extra_adult: string;
  markup_pct: string;
  tax_type: string;
  currency: string;
  pricing_notes: string;

  inclusions: string;
  exclusions: string;

  cancellation_policy: string;
  refund_policy: string;
  terms_and_conditions: string;

  cover_image_url: string;
  gallery_urls: string[];

  // Itinerary PDF sent by the WhatsApp bot when a customer picks this package.
  itinerary_pdf_object_key: string;
  itinerary_pdf_file_name: string;
  // Meta ad campaign this package auto-matches to for the WhatsApp bot.
  campaign_name: string;
}

export const EMPTY_PACKAGE_FORM: PackageFormData = {
  name: '', package_code: '', type: '', destinations: [],
  duration_days: 5, duration_nights: 4, start_date: '', end_date: '',
  max_pax: '', language: 'English', is_active: true, is_template: true,
  description: '', highlights: '',
  itinerary: [],
  hotels: [],
  flights: [], transfers: [],
  net_price: '', base_price_adult: '', base_price_child: '',
  price_child_nobed: '', price_infant: '', price_extra_adult: '',
  markup_pct: '15', tax_type: 'GST 5%', currency: 'INR', pricing_notes: '',
  inclusions: '', exclusions: '',
  cancellation_policy: '', refund_policy: '', terms_and_conditions: '',
  cover_image_url: '', gallery_urls: [],
  itinerary_pdf_object_key: '', itinerary_pdf_file_name: '',
  campaign_name: '',
};

export interface TourPackage {
  id: string;
  name: string;
  package_code: string | null;
  type: string | null;
  destinations: string[] | null;
  duration_days: number | null;
  duration_nights: number | null;
  start_date: string | null;
  end_date: string | null;
  max_pax: number | null;
  language: string | null;
  is_active: boolean;
  is_template: boolean;
  description: string | null;
  highlights: string | null;
  net_price: number | null;
  base_price_adult: number | null;
  base_price_child: number | null;
  price_child_nobed: number | null;
  price_infant: number | null;
  price_extra_adult: number | null;
  markup_pct: number | null;
  tax_type: string | null;
  currency: string | null;
  pricing_notes: string | null;
  inclusions: string[] | null;
  exclusions: string[] | null;
  cancellation_policy: string | null;
  refund_policy: string | null;
  terms_and_conditions: string | null;
  cover_image_url: string | null;
  gallery_urls: string[] | null;
  itinerary_pdf_object_key: string | null;
  itinerary_pdf_file_name: string | null;
  campaign_name: string | null;
  contact_number: string | null;
  contact_name: string | null;
  contact_button_text: string | null;
  buttons?: PackageButton[] | null;
  meta_details?: { name: string | null; category: string | null; language: string | null; quality: string | null; rejected_reason: string | null; last_updated: string | null } | null;
  whatsapp_template_id: string | null;
  whatsapp_template_name: string | null;
  whatsapp_template_status: string;
  whatsapp_template_rejection_reason: string | null;
  additional_documents?: { id: string; duration_days: number | null; duration_nights: number | null; file_name: string | null; object_key: string | null; whatsapp_template_status: string | null }[];
  branch_id: string;
  created_at: string;
  hotels?: any[];
  flights?: any[];
  transfers?: any[];
  itinerary?: any[];
}

export interface PackageButton { type: 'call' | 'url' | 'chat' | 'duration'; text: string; phone?: string; url?: string; reply?: string; replyTouched?: boolean; customLabel?: string }
