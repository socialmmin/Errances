import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, PayloadTooLargeException, Put, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { BUILT_IN_MAX_BYTES, R2Service } from '../../common/r2/r2.service';

// Upload and download links for built-in storage (files kept in the CRM database when no R2
// bucket is configured). These stand in for R2's presigned URLs: each link is signed by
// R2Service for one object key and one operation, and expires -- the link itself is the
// permission, exactly like a presigned URL, so there is no login check here.
@Controller('files/builtin')
export class BuiltInFilesController {
  constructor(private r2: R2Service) {}

  @Put(':token')
  async upload(@Param('token') token: string, @Req() req: Request) {
    const claim = this.r2.verifyLink(token, 'put');
    if (!claim) throw new ForbiddenException('This upload link is invalid or has expired');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > BUILT_IN_MAX_BYTES) throw new PayloadTooLargeException('File is too large');
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > BUILT_IN_MAX_BYTES) { reject(new PayloadTooLargeException('File is too large')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    if (!size) throw new BadRequestException('The file is empty');
    await this.r2.putBuiltIn(claim.key, Buffer.concat(chunks), claim.contentType || String(req.headers['content-type'] || 'application/octet-stream'));
    return { ok: true };
  }

  @SkipThrottle()
  @Get(':token/:name')
  async download(@Param('token') token: string, @Res() res: Response) {
    const claim = this.r2.verifyLink(token, 'get');
    if (!claim) throw new ForbiddenException('This link is invalid or has expired');
    const object = await this.r2.getObject(claim.key);
    if (!object) throw new NotFoundException();
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Length', String(object.body.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Shown inside the CRM app (PDF / image previews), which runs on a different address.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Frame-Options');
    res.send(object.body);
  }
}
