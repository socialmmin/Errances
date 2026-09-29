import { IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

const TRAVEL_TYPES = ['family', 'couple', 'solo', 'group', 'corporate', 'honeymoon'];
const SOURCES = ['website', 'referral', 'walk_in', 'social_media', 'phone', 'whatsapp', 'agent', 'meta_ads', 'other'];
const PRIORITIES = ['strong', 'hot', 'cold', 'dead'];
const STATUSES = ['interested', 'advance_paid', 'just_checking', 'invalid_number', 'wrong_number', 'duplicate', 'new', 'contacted', 'follow_up', 'qualified', 'quotation_sent', 'negotiation', 'booking_confirmed', 'won', 'no_response', 'not_interested', 'lost'];

export class CreateLeadDto {
  @IsString()
  customerName!: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsappNumber?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsDateString() travelFrom?: string;
  @IsOptional() @IsDateString() travelTo?: string;
  @IsOptional() @IsInt() @Min(0) adults?: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @IsInt() @Min(0) infants?: number;
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsIn(TRAVEL_TYPES) travelType?: string;
  @IsOptional() @IsIn(SOURCES) source?: string;
  @IsOptional() @IsUUID() assignedTo?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) expectedRevenue?: number;
  @IsOptional() @IsString() remarks?: string;

  // Inbound WhatsApp bot / Meta Ads attribution.
  @IsOptional() @IsString() whatsappContactId?: string;
  @IsOptional() @IsString() whatsappStatus?: string;
  @IsOptional() @IsString() campaignName?: string;
  @IsOptional() @IsString() adName?: string;
  @IsOptional() @IsInt() leadMonth?: number;
  @IsOptional() @IsInt() leadYear?: number;
  @IsOptional() @IsObject() metaAttribution?: Record<string, any>;

  @IsUUID()
  branchId!: string;
}
