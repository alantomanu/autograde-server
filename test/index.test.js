import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock the dependencies
jest.mock('./ocr.js', () => ({
  processImageWithAI: jest.fn()
}));

jest.mock('./pdfProcessor.js', () => ({
  extractTextFromPDF: jest.fn(),
  parseAnswerKeyToJSON: jest.fn()
}));

jest.mock('./evaluator.js', () => ({
  evaluateAnswerSheet: jest.fn(),
  evaluateSingleAnswer: jest.fn()
}));

jest.mock('./rag-pg.js', () => ({
  initSchema: jest.fn(),
  upsertRagDocuments: jest.fn(),
  countDocuments: jest.fn(),
  retrieveCandidates: jest.fn(),
  rerank: jest.fn()
}));

// Import the app after mocking dependencies
import app from '../src/index.js';

describe('Express App Endpoints', () => {
  // Test the ping endpoint
  describe('GET /ping', () => {
    it('should respond with pong', async () => {
      const response = await request(app).get('/ping');
      expect(response.status).toBe(200);
      expect(response.text).toBe('pong');
    });
  });

  // Test OCR endpoint
  describe('POST /perform-ocr', () => {
    it('should return 400 if no PDF URL provided', async () => {
      const response = await request(app)
        .post('/perform-ocr')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PDF URL is required');
    });

    it('should process OCR successfully', async () => {
      const mockResult = { text: 'Sample OCR result' };
      processImageWithAI.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/perform-ocr')
        .send({ pdfUrl: 'http://example.com/test.pdf' });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
    });
  });

  // Test PDF conversion endpoint
  describe('POST /convert-pdf', () => {
    it('should return 400 if no PDF URL provided', async () => {
      const response = await request(app)
        .post('/convert-pdf')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PDF URL is required');
    });

    it('should convert PDF successfully', async () => {
      const mockExtractedText = 'Sample extracted text';
      const mockJsonData = { key: 'value' };
      
      extractTextFromPDF.mockResolvedValue(mockExtractedText);
      parseAnswerKeyToJSON.mockReturnValue(mockJsonData);

      const response = await request(app)
        .post('/convert-pdf')
        .send({ pdfUrl: 'http://example.com/test.pdf' });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: mockJsonData
      });
    });
  });

  // Test evaluation endpoints
  describe('POST /evaluate', () => {
    it('should evaluate answer sheet successfully', async () => {
      const mockResult = { score: 90 };
      evaluateAnswerSheet.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/evaluate')
        .send({ answers: ['a', 'b', 'c'] });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
    });
  });

  describe('POST /evaluate-single', () => {
    it('should evaluate single answer successfully', async () => {
      const mockResult = { score: 5 };
      evaluateSingleAnswer.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/evaluate-single')
        .send({ answer: 'test answer' });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        result: mockResult
      });
    });
  });

  // Test RAG endpoints
  describe('RAG Endpoints', () => {
    describe('POST /rag/init', () => {
      it('should initialize schema successfully', async () => {
        initSchema.mockResolvedValue();

        const response = await request(app)
          .post('/rag/init');
        
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });

    describe('GET /status', () => {
      it('should return document count', async () => {
        const mockCount = 42;
        countDocuments.mockResolvedValue(mockCount);

        const response = await request(app)
          .get('/status');
        
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          success: true,
          total_paragraphs: mockCount
        });
      });
    });

    describe('GET /search', () => {
      it('should return search results', async () => {
        const mockCandidates = ['result1', 'result2'];
        const mockRanked = ['ranked1', 'ranked2'];
        
        retrieveCandidates.mockResolvedValue(mockCandidates);
        rerank.mockResolvedValue(mockRanked);

        const response = await request(app)
          .get('/search?q=test&k=5&fetchK=20');
        
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          success: true,
          query: 'test',
          topK: 5,
          results: mockRanked
        });
      });

      it('should return 400 if query is missing', async () => {
        const response = await request(app)
          .get('/search');
        
        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          success: false,
          error: 'Missing q'
        });
      });
    });
  });
});