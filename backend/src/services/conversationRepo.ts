import { pool } from '../db.js';

export type ConversationStage = 'collect_name' | 'package_selection' | 'completed';

export type Conversation = {
    id: string;
    phone: string;
    stage: ConversationStage;
    selected_package: string | null;
};

export async function getConversationByPhone(phone: string): Promise<Conversation | null> {
    const { rows } = await pool.query<Conversation>('SELECT * FROM whatsapp_conversations WHERE phone = $1', [phone]);
    return rows[0] ?? null;
}

export async function createConversation(phone: string): Promise<Conversation> {
    const { rows } = await pool.query<Conversation>(
        `INSERT INTO whatsapp_conversations (phone, stage) VALUES ($1, 'collect_name') RETURNING *`,
        [phone]
    );
    return rows[0];
}

export async function updateConversation(phone: string, stage: ConversationStage, selectedPackage: string | null = null): Promise<Conversation> {
    const { rows } = await pool.query<Conversation>(
        `UPDATE whatsapp_conversations SET stage = $1, selected_package = $2, updated_at = NOW() WHERE phone = $3 RETURNING *`,
        [stage, selectedPackage, phone]
    );
    return rows[0];
}
