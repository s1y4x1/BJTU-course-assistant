(function (global) {
  'use strict';

  function visibleConversations(state) {
    const views = state?.conversations || {};
    const history = new Set((state?.messages || []).map(message => message.conversationId));
    const entries = [
      {id: 'public', kind: 'group'},
      ...(state?.rooms || []).map(room => ({...room, kind: 'group'})),
      ...(state?.peers || []).flatMap(peer => {
        const id = `peer:${peer.id}`;
        return Object.hasOwn(views, id) || history.has(id) ? [{...peer, id, peerId: peer.id, kind: 'private'}] : [];
      })
    ];
    return entries.flatMap(entry => {
      const view = views[entry.id] || {};
      return view.hidden ? [] : [{...entry, view}];
    });
  }

  function unreadCount(view) {
    return Math.max(0, Number(view.unread) || 0);
  }

  global.BjtuChatroomConversations = {visibleConversations, unreadCount};
})(globalThis);
