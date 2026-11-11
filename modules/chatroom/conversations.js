(function (global) {
  'use strict';

  function visibleConversations(state) {
    const entries = [
      {id: 'public', kind: 'group'},
      ...(state?.rooms || []).map(room => ({...room, kind: 'group'})),
      ...(state?.peers || []).map(peer => ({...peer, id: `peer:${peer.id}`, peerId: peer.id, kind: 'private'}))
    ];
    return entries.flatMap(entry => {
      const view = state?.conversations?.[entry.id] || {};
      return view.hidden ? [] : [{...entry, view}];
    });
  }

  function unreadCount(view) {
    return Math.max(0, Number(view.unread) || 0);
  }

  global.BjtuChatroomConversations = {visibleConversations, unreadCount};
})(globalThis);
