import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import { Router } from 'express';

export const conversationRouter = Router();

// Get all conversations (most recent first)
conversationRouter.get('/conversations', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const conversations = sqlite.getRecentConversations(limit);
    res.json(conversations);
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get a specific conversation
conversationRouter.get('/conversations/:id', (req, res) => {
  try {
    const conversation = sqlite.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// Create a new conversation (session start)
conversationRouter.post('/conversations', (req, res) => {
  try {
    const { id, query, metadata } = req.body;

    if (!id || !query) {
      return res.status(400).json({ error: 'id and query are required' });
    }

    sqlite.saveConversation(id, query, null, metadata || {});
    res.status(201).json({ id, query, metadata });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Update conversation response (session complete)
conversationRouter.patch('/conversations/:id', (req, res) => {
  try {
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'response is required' });
    }

    sqlite.updateConversationResponse(req.params.id, response);
    const updated = sqlite.getConversation(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating conversation:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// Get tool calls for a session
conversationRouter.get('/conversations/:id/tool-calls', (req, res) => {
  try {
    const toolCalls = sqlite.getToolCallsBySession(req.params.id);
    res.json(toolCalls);
  } catch (error) {
    console.error('Error getting tool calls:', error);
    res.status(500).json({ error: 'Failed to get tool calls' });
  }
});

// Get recent tool calls (across all sessions)
conversationRouter.get('/tool-calls', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const toolCalls = sqlite.getRecentToolCalls(limit);
    res.json(toolCalls);
  } catch (error) {
    console.error('Error getting tool calls:', error);
    res.status(500).json({ error: 'Failed to get tool calls' });
  }
});
