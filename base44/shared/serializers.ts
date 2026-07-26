export function publicPacket(packet: any) {
  return {
    public_ref: packet.public_ref,
    status: packet.status,
    page_title: packet.page_title ?? null,
    page_url: packet.page_url ?? null,
    created_date: packet.created_date,
    acknowledged_at: packet.acknowledged_at ?? null,
    resolved_at: packet.resolved_at ?? null,
    last_public_update_at: packet.last_public_update_at ?? null,
  };
}

export function publicEvent(event: any) {
  return {
    event_type: event.event_type,
    message: event.message ?? null,
    created_date: event.created_date,
  };
}
