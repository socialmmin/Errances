import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const PACKAGE_TYPES = [
  'domestic',
  'international',
  'fit',
  'group',
  'honeymoon',
  'corporate',
  'pilgrimage',
  'educational',
  'luxury',
  'adventure',
  'cruise',
  'custom',
];

export class HotelItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() optionLabel?: string;
  @IsString() hotelName!: string;
  @IsOptional() @IsString() starCategory?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsDateString() checkinDate?: string;
  @IsOptional() @IsDateString() checkoutDate?: string;
  @IsOptional() @IsInt() @Min(0) rooms?: number;
  @IsOptional() @IsString() mealPlan?: string;
  @IsOptional() @IsString() roomCategory?: string;
  @IsOptional() @IsString() roomOccupancy?: string;
  @IsOptional() @IsString() notes?: string;
}

export class FlightItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() flightNo?: string;
  @IsOptional() @IsString() airline?: string;
  @IsOptional() @IsString() class?: string;
  @IsOptional() @IsString() fromCity?: string;
  @IsOptional() @IsDateString() fromDatetime?: string;
  @IsOptional() @IsString() toCity?: string;
  @IsOptional() @IsDateString() toDatetime?: string;
  @IsOptional() @IsString() notes?: string;
}

export class TransferItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() transferName?: string;
  @IsOptional() @IsString() vehicleType?: string;
  @IsOptional() @IsString() fromLocation?: string;
  @IsOptional() @IsString() toLocation?: string;
  @IsOptional() @IsDateString() transferDatetime?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ItineraryMealsDto {
  @IsOptional() @IsBoolean() breakfast?: boolean;
  @IsOptional() @IsBoolean() lunch?: boolean;
  @IsOptional() @IsBoolean() dinner?: boolean;
  @IsOptional() @IsBoolean() allInclusive?: boolean;
}

export class ItineraryStopDto {
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsString() placeName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
}

export class ItineraryDayItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(1) dayNumber!: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @ValidateNested() @Type(() => ItineraryMealsDto) meals?: ItineraryMealsDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItineraryStopDto) stops?: ItineraryStopDto[];
}

export class CreatePackageDto {
  @IsString() name!: string;
  @IsOptional() @IsString() packageCode?: string;
  @IsOptional() @IsIn(PACKAGE_TYPES) type?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) destinations?: string[];
  @IsOptional() @IsInt() @Min(0) durationDays?: number;
  @IsOptional() @IsInt() @Min(0) durationNights?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsInt() @Min(1) maxPax?: number;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isTemplate?: boolean;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() highlights?: string;

  @IsOptional() @IsNumber() netPrice?: number;
  @IsOptional() @IsNumber() basePriceAdult?: number;
  @IsOptional() @IsNumber() basePriceChild?: number;
  @IsOptional() @IsNumber() priceChildNobed?: number;
  @IsOptional() @IsNumber() priceInfant?: number;
  @IsOptional() @IsNumber() priceExtraAdult?: number;
  @IsOptional() @IsNumber() markupPct?: number;
  @IsOptional() @IsString() taxType?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() pricingNotes?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) exclusions?: string[];

  @IsOptional() @IsString() cancellationPolicy?: string;
  @IsOptional() @IsString() refundPolicy?: string;
  @IsOptional() @IsString() termsAndConditions?: string;

  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) galleryUrls?: string[];

  // R2 object key for the itinerary PDF sent by the WhatsApp bot when a
  // customer picks this package from the interactive list.
  @IsOptional() @IsString() itineraryPdfObjectKey?: string;
  @IsOptional() @IsString() itineraryPdfFileName?: string;

  // Meta ad campaign name this package belongs to (e.g. "SMM Vietnam -
  // High Intent Traveller - Sep 2026"). Lets the WhatsApp bot auto-send
  // this package's itinerary to anyone clicking in from that campaign.
  @IsOptional() @IsString() campaignName?: string;

  // Consultant call number shown as a tap-to-call button in the WhatsApp itinerary message.
  @IsOptional() @IsString() contactNumber?: string;
  @IsOptional() @IsString() contactName?: string;
  // WhatsApp buttons: [{ type: call|url|chat, text, phone?, url? }]
  @IsOptional() @IsArray() buttons?: { type: string; text: string; phone?: string; url?: string }[];
  @IsOptional() @IsString() contactButtonText?: string;

  @IsUUID() branchId!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => HotelItemDto) hotels?: HotelItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FlightItemDto) flights?: FlightItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TransferItemDto) transfers?: TransferItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItineraryDayItemDto) itinerary?: ItineraryDayItemDto[];
}
