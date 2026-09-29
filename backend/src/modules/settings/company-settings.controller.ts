import { Body, Controller, Get, Inject, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../common/db/pool.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/role-permissions';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
const FIELDS: Record<string,string>={companyName:'company_name',legalName:'legal_name',tagline:'tagline',logoUrl:'logo_url',logoObjectKey:'logo_object_key',faviconUrl:'favicon_url',faviconObjectKey:'favicon_object_key',phone:'phone',email:'email',website:'website',address:'address',gstin:'gstin',bankName:'bank_name',bankAccountName:'bank_account_name',bankAccountNumber:'bank_account_number',bankIfsc:'bank_ifsc',bankBranch:'bank_branch',upiId:'upi_id'};
@Controller('settings/company')
export class CompanySettingsController {
  constructor(@Inject(PG_POOL) private pool:Pool,private config:ConfigService){}
  @Get('public') async publicBranding(){const {rows}=await this.pool.query(`SELECT company_name,tagline,logo_url,favicon_url FROM company_settings WHERE id=true`);return rows[0]||{company_name:'Errances Voyages',tagline:'Travels CRM'};}
  @Get() @UseGuards(JwtAuthGuard,PermissionsGuard) @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async get(){const {rows}=await this.pool.query(`SELECT * FROM company_settings WHERE id=true`);return rows[0];}
  @Patch() @UseGuards(JwtAuthGuard,PermissionsGuard) @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async update(@Body() dto:UpdateCompanySettingsDto,@Req() req:any){const sets:string[]=[];const args:any[]=[];for(const [key,col] of Object.entries(FIELDS)){const value=(dto as any)[key];if(value!==undefined){args.push(value||null);sets.push(`${col}=$${args.length}`);}}if(!sets.length)return this.get();args.push(req.user.userId);const {rows}=await this.pool.query(`UPDATE company_settings SET ${sets.join(',')},updated_by=$${args.length},updated_at=now() WHERE id=true RETURNING *`,args);return rows[0];}
  @Get('integrations') @UseGuards(JwtAuthGuard,PermissionsGuard) @RequirePermissions(PERMISSIONS.SETTINGS_BRANCHES)
  async integrations(@Query('reveal') reveal?:string){const {rows}=await this.pool.query(`SELECT phone_number_id,business_account_id,access_token_encrypted,is_configured FROM whatsapp_config ORDER BY created_at DESC LIMIT 1`);const wa=rows[0];const show=reveal==='true';const value=(v?:string|null)=>!v?'':show?v:`••••••••${v.slice(-4)}`;return{data:[
    {key:'meta_ads',name:'Meta Ads',configured:!!(this.config.get('META_SYSTEM_USER_ACCESS_TOKEN')&&this.config.get('META_AD_ACCOUNT_ID')),purpose:'Campaigns, spend and lead capture',fields:[{label:'Ad account ID',value:value(this.config.get('META_AD_ACCOUNT_ID'))},{label:'System user token',value:value(this.config.get('META_SYSTEM_USER_ACCESS_TOKEN'))},{label:'Page ID',value:value(this.config.get('META_PAGE_ID'))},{label:'App ID',value:value(this.config.get('META_APP_ID'))}]},
    {key:'whatsapp',name:'WhatsApp Cloud API',configured:!!wa?.is_configured,purpose:'Template-powered itinerary delivery',editHref:'/settings/whatsapp',fields:[{label:'Phone number ID',value:value(wa?.phone_number_id)},{label:'Business account ID',value:value(wa?.business_account_id)},{label:'Access token',value:value(wa?.access_token_encrypted)}]},
    {key:'storage',name:'Cloudflare R2 Storage',configured:!!(this.config.get('R2_BUCKET')&&this.config.get('R2_ACCESS_KEY_ID')),purpose:'Logos, itineraries and documents',fields:[{label:'Bucket',value:value(this.config.get('R2_BUCKET'))},{label:'Access key',value:value(this.config.get('R2_ACCESS_KEY_ID'))},{label:'Secret key',value:value(this.config.get('R2_SECRET_ACCESS_KEY'))},{label:'Endpoint',value:value(this.config.get('R2_ENDPOINT'))}]},
    {key:'push',name:'Push Notifications',configured:!!(this.config.get('VAPID_PUBLIC_KEY')&&this.config.get('VAPID_PRIVATE_KEY')),purpose:'Lead and critical campaign alerts',fields:[{label:'Public key',value:value(this.config.get('VAPID_PUBLIC_KEY'))},{label:'Private key',value:value(this.config.get('VAPID_PRIVATE_KEY'))}]}]};}
}
