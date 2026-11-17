(function (global) {
  'use strict';

  function visibleConversations(state) {
    const views = state?.conversations || {};
    const history = new Set((state?.messages || []).map(message => message.conversationId));
    const rooms = state?.rooms || [];
    const activeRooms = new Set(rooms.map(room => room.id));
    const entries = [
      {id: 'public', kind: 'group'},
      ...rooms.map(room => ({...room, kind: 'group'})),
      ...Object.entries(views).flatMap(([id, view]) => view.leftGroupName && !activeRooms.has(id)
        ? [{id, name:view.leftGroupName, kind:'group', left:true}] : []),
      ...(state?.peers || []).flatMap(peer => {
        const id = `peer:${peer.id}`;
        return Object.hasOwn(views, id) || history.has(id) ? [{...peer, id, peerId: peer.id, kind: 'private'}] : [];
      })
    ];
    return entries.flatMap(entry => {
      const view = views[entry.id] || {};
      return view.hidden ? [] : [{...entry, view}];
    }).sort((a,b) => (b.view.pinnedAt || 0) - (a.view.pinnedAt || 0) || (b.view.lastAt || 0) - (a.view.lastAt || 0));
  }

  function unreadCount(view) {
    return Math.max(0, Number(view.unread) || 0);
  }

  global.BjtuChatroomConversations = {visibleConversations, unreadCount};
})(globalThis);
