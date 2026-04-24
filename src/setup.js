// Setup screen logic
const apiKeyInput = document.getElementById('apiKey');
const toggleBtn = document.getElementById('toggleKey');
const validateBtn = document.getElementById('validateBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const errorMsg = document.getElementById('errorMsg');
const successMsg = document.getElementById('successMsg');

// Toggle password visibility
toggleBtn.addEventListener('click', () => {
    const type = apiKeyInput.type === 'password' ? 'text' : 'password';
    apiKeyInput.type = type;
    toggleBtn.querySelector('.show-icon').textContent = type === 'password' ? '👁️' : '🙈';
});

// Handle multiple provider links (uses secure IPC)
document.querySelectorAll('.provider-link').forEach(link => {
    link.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = e.target.dataset.url || e.target.closest('a').dataset.url;
        await window.electronAPI.openExternal(url);
    });
});

// Validate and save API key
validateBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        showError('Please enter your API key');
        return;
    }

    // Detect provider based on key format
    let provider = 'Unknown';
    if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-ant-')) {
        provider = 'OpenAI';
    } else if (apiKey.startsWith('sk-ant-')) {
        provider = 'Anthropic';
    } else if (apiKey.startsWith('AIzaSy')) {
        provider = 'Google';
    } else {
        showError('Invalid API key format. Please check your key and try again.');
        return;
    }

    // Show loading
    validateBtn.disabled = true;
    btnText.textContent = `Validating ${provider} key...`;
    btnText.style.display = 'inline';
    btnLoader.style.display = 'inline-block';
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';

    try {
        // Test API key (secure - runs in main process)
        const result = await window.electronAPI.testApiKey(apiKey);
        
        if (result.success) {
            // Save API key (encrypted with OS-level protection)
            const saveResult = await window.electronAPI.setApiKey(apiKey);
            
            if (saveResult.success) {
                showSuccess(`${provider} API key validated and saved successfully!`);
                setTimeout(() => {
                    window.electronAPI.loadMainApp();
                }, 1500);
            } else {
                showError('Failed to save API key: ' + saveResult.error);
                resetButton();
            }
        } else {
            showError(`Invalid ${provider} API key: ` + result.error);
            resetButton();
        }
    } catch (error) {
        showError('Error: ' + error.message);
        resetButton();
    }
});

// Enter key to submit
apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        validateBtn.click();
    }
});

function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = 'block';
    successMsg.style.display = 'none';
}

function showSuccess(message) {
    successMsg.textContent = message;
    successMsg.style.display = 'block';
    errorMsg.style.display = 'none';
}

function resetButton() {
    validateBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoader.style.display = 'none';
}
