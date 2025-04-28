document.addEventListener('DOMContentLoaded', function() {
    // DOM元素
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const typingIndicator = document.getElementById('typing-indicator');
    const modelSelect = document.getElementById('model-select');
    const clearChatBtn = document.getElementById('clear-chat');
    
    // 状态变量
    let isStreaming = false;
    let currentAiMessage = null;
    let controller = null;
    const CHAT_STORAGE_KEY = 'deepseek_chat_history';
    let conversationHistory = [];
    
    // 默认配置
    const config = {
        apiKey: 'sk-3a909b2223304662ae5f3f9db4016184',
        baseUrl: 'https://api.deepseek.com'
    };

    // 初始化模型选择器
    function initModelSelector() {
        modelSelect.innerHTML = '';
        
        const v3Option = document.createElement('option');
        v3Option.value = 'deepseek-chat';
        v3Option.textContent = 'DeepSeek-V3';
        modelSelect.appendChild(v3Option);
        
        const r1Option = document.createElement('option');
        r1Option.value = 'deepseek-reasoner';
        r1Option.textContent = 'DeepSeek-R1';
        modelSelect.appendChild(r1Option);
        
        // 设置默认选中项
        modelSelect.value = 'deepseek-chat';
    }

    // 自动调整输入框高度
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        sendButton.disabled = this.value.trim() === '';
    });

    // 加载聊天记录
    function loadChatHistory() {
        const savedChat = localStorage.getItem(CHAT_STORAGE_KEY);
        if (savedChat) {
            chatMessages.innerHTML = savedChat;
            document.querySelectorAll('.ai-message').forEach(addCopyButton);
            rebuildConversationHistory();
            setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
        } else {
            addMessage('你好！我是基于DeepSeek的AI助手。有什么我可以帮助你的吗？', false);
            conversationHistory.push({
                role: 'assistant',
                content: '你好！我是基于DeepSeek的AI助手。有什么我可以帮助你的吗？'
            });
        }
        sendButton.disabled = userInput.value.trim() === '';
    }

    // 添加复制按钮
    function addCopyButton(messageElement) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = '复制文本';
        copyBtn.addEventListener('click', function() {
            const content = messageElement.querySelector('.message-content')?.textContent || messageElement.textContent;
            navigator.clipboard.writeText(content.trim()).then(() => {
                copyBtn.innerHTML = '✓';
                setTimeout(() => copyBtn.innerHTML = '📋', 2000);
            });
        });
        messageElement.appendChild(copyBtn);
    }

    // 重建对话历史
    function rebuildConversationHistory() {
        conversationHistory = [];
        document.querySelectorAll('.message').forEach(el => {
            const isUser = el.classList.contains('user-message');
            const content = isUser ? el.textContent.replace('📋', '').trim() : 
                                  el.querySelector('.message-content')?.textContent.trim();
            if (content) {
                conversationHistory.push({
                    role: isUser ? 'user' : 'assistant',
                    content: content.replace(/\s+/g, ' ').trim()
                });
            }
        });
    }

    // 保存聊天记录
    function saveChatHistory() {
        localStorage.setItem(CHAT_STORAGE_KEY, chatMessages.innerHTML);
    }

    // 清空聊天记录
    function clearChatHistory() {
        if (confirm('确定要清空所有聊天记录吗？')) {
            localStorage.removeItem(CHAT_STORAGE_KEY);
            chatMessages.innerHTML = '';
            conversationHistory = [];
            addMessage('聊天记录已清空。有什么我可以帮助你的吗？', false);
            conversationHistory.push({
                role: 'assistant',
                content: '聊天记录已清空。有什么我可以帮助你的吗？'
            });
        }
    }

    // 获取当前时间
    function getCurrentTime() {
        return new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    // 添加消息
    function addMessage(content, isUser) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        
        messageDiv.innerHTML = `
            ${isUser ? content : '<div class="message-content">' + content + '</div>'}
            <div class="message-time">${getCurrentTime()}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        if (!isUser) {
            addCopyButton(messageDiv);
            currentAiMessage = messageDiv.querySelector('.message-content');
        }
        
        chatMessages.scrollTop = chatMessages.scrollHeight;
        saveChatHistory();
        return messageDiv;
    }

    // 处理流式响应
    async function handleStreamResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedContent = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            while (true) {
                const boundary = buffer.indexOf('\n');
                if (boundary === -1) break;
                
                const chunk = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 1);
                
                if (chunk.trim() === 'data: [DONE]') {
                    currentAiMessage.innerHTML = accumulatedContent;
                    conversationHistory.push({ role: 'assistant', content: accumulatedContent });
                    saveChatHistory();
                    return;
                }
                
                try {
                    if (chunk.startsWith('data: ')) {
                        const data = JSON.parse(chunk.substring(6));
                        const content = data.choices[0].delta.content || '';
                        accumulatedContent += content;
                        currentAiMessage.innerHTML = accumulatedContent + '<span class="streaming-cursor"></span>';
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                } catch (e) {
                    console.error('解析JSON出错:', e);
                }
            }
        }
        
        currentAiMessage.innerHTML = accumulatedContent;
        conversationHistory.push({ role: 'assistant', content: accumulatedContent });
        saveChatHistory();
    }

    // 调用DeepSeek API
    async function callDeepSeekAPI(prompt) {
        if (!config.apiKey) {
            addMessage('错误：未配置API密钥', false);
            return;
        }
        
        const model = modelSelect.value;
        const endpoint = `${config.baseUrl}/chat/completions`;
        
        try {
            typingIndicator.style.display = 'block';
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            conversationHistory.push({ role: 'user', content: prompt });
            
            controller = new AbortController();
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: conversationHistory,
                    temperature: 0.7,
                    stream: true
                }),
                signal: controller.signal
            });
            
            if (!response.ok) {
                throw new Error(`API请求失败: ${response.status}`);
            }
            
            await handleStreamResponse(response);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('请求已被用户中止');
                currentAiMessage.textContent = "思考已停止";
                conversationHistory.pop();
            } else {
                console.error('调用API出错:', error);
                currentAiMessage.textContent = `抱歉，处理您的请求时出现了问题。${error.message}`;
                conversationHistory.pop();
            }
            saveChatHistory();
        } finally {
            typingIndicator.style.display = 'none';
            isStreaming = false;
            sendButton.textContent = "发送";
            sendButton.classList.remove('stop');
            controller = null;
        }
    }
    
    // 停止当前思考
    function stopThinking() {
        if (controller) controller.abort();
        isStreaming = false;
        sendButton.textContent = "发送";
        sendButton.classList.remove('stop');
    }
    
    // 处理发送消息
    async function handleSendMessage() {
        if (isStreaming) {
            stopThinking();
            return;
        }
        
        const message = userInput.value.trim();
        if (!message) return;
        
        addMessage(message, true);
        userInput.value = '';
        userInput.style.height = 'auto';
        sendButton.disabled = true;
        
        addMessage('', false);
        isStreaming = true;
        sendButton.textContent = "停止思考";
        sendButton.classList.add('stop');
        sendButton.disabled = false;
        
        await callDeepSeekAPI(message);
    }
    
    // 事件监听
    sendButton.addEventListener('click', handleSendMessage);
    clearChatBtn.addEventListener('click', clearChatHistory);
    
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    
    // 初始化
    initModelSelector();
    loadChatHistory();
});