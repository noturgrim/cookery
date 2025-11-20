/**
 * Day Night UI Controller
 * Provides UI controls for the day-night cycle system
 */
export class DayNightUI {
  constructor(dayNightCycle) {
    this.dayNightCycle = dayNightCycle;
    this.container = null;
    this.isVisible = false;
    this.createUI();
  }

  /**
   * Create the UI elements
   */
  createUI() {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "day-night-ui";
    this.container.className = "day-night-ui";
    this.container.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 15px;
      border-radius: 10px;
      font-family: Arial, sans-serif;
      min-width: 250px;
      z-index: 1000;
      backdrop-filter: blur(10px);
      border: 2px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      display: none;
    `;

    // Create content
    const content = `
      <div style="margin-bottom: 15px; border-bottom: 2px solid rgba(255, 255, 255, 0.2); padding-bottom: 10px;">
        <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #87ceeb;">🌅 Day-Night Cycle</h3>
        <div id="time-display" style="font-size: 24px; font-weight: bold; color: #ffd700;">12:00 PM</div>
        <div id="period-display" style="font-size: 14px; color: #aaa;">Noon</div>
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #aaa;">Time of Day</label>
        <input 
          type="range" 
          id="time-slider" 
          min="0" 
          max="24" 
          step="0.1" 
          value="12"
          style="width: 100%; cursor: pointer;"
        />
      </div>

      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #aaa;">Time Speed: <span id="speed-value">0.1x</span></label>
        <input 
          type="range" 
          id="speed-slider" 
          min="0" 
          max="2" 
          step="0.05" 
          value="0.1"
          style="width: 100%; cursor: pointer;"
        />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
        <button id="preset-dawn" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #ff6b4a, #ff9966); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Dawn</button>
        <button id="preset-morning" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #87ceeb, #b0d8f0); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Morning</button>
        <button id="preset-noon" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #87ceeb, #87ceeb); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Noon</button>
        <button id="preset-afternoon" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #ffa866, #87ceeb); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Afternoon</button>
        <button id="preset-evening" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #ff7744, #ff5533); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Evening</button>
        <button id="preset-night" class="time-preset-btn" style="padding: 8px; background: linear-gradient(135deg, #1e1e3e, #0f0f2e); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; transition: transform 0.2s;">Night</button>
      </div>

      <button id="pause-toggle" style="width: 100%; padding: 10px; background: #4CAF50; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s;">
        ⏸️ Pause
      </button>
    `;

    this.container.innerHTML = content;
    document.body.appendChild(this.container);

    // Add hover effects for buttons
    const style = document.createElement("style");
    style.textContent = `
      .time-preset-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .time-preset-btn:active {
        transform: scale(0.95);
      }
      #pause-toggle:hover {
        transform: scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
    `;
    document.head.appendChild(style);

    this.setupEventListeners();
    this.updateDisplay();
  }

  /**
   * Setup event listeners for UI controls
   */
  setupEventListeners() {
    // Time slider
    const timeSlider = document.getElementById("time-slider");
    if (timeSlider) {
      timeSlider.addEventListener("input", (e) => {
        this.dayNightCycle.setTime(parseFloat(e.target.value));
        this.updateDisplay();
      });
    }

    // Speed slider
    const speedSlider = document.getElementById("speed-slider");
    if (speedSlider) {
      speedSlider.addEventListener("input", (e) => {
        const speed = parseFloat(e.target.value);
        this.dayNightCycle.setTimeSpeed(speed);
        document.getElementById("speed-value").textContent = `${speed.toFixed(
          2
        )}x`;
      });
    }

    // Preset buttons
    const presets = [
      "dawn",
      "morning",
      "noon",
      "afternoon",
      "evening",
      "night",
    ];
    presets.forEach((preset) => {
      const btn = document.getElementById(`preset-${preset}`);
      if (btn) {
        btn.addEventListener("click", () => {
          this.dayNightCycle.setTimePreset(preset);
          this.updateDisplay();
        });
      }
    });

    // Pause toggle
    const pauseBtn = document.getElementById("pause-toggle");
    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        const isPaused = this.dayNightCycle.togglePause();
        pauseBtn.textContent = isPaused ? "▶️ Resume" : "⏸️ Pause";
        pauseBtn.style.background = isPaused ? "#ff9800" : "#4CAF50";
      });
    }

    // Update display continuously
    setInterval(() => this.updateDisplay(), 100);
  }

  /**
   * Update time display
   */
  updateDisplay() {
    const timeDisplay = document.getElementById("time-display");
    const periodDisplay = document.getElementById("period-display");
    const timeSlider = document.getElementById("time-slider");

    if (timeDisplay) {
      timeDisplay.textContent = this.dayNightCycle.getTimeString();
    }

    if (periodDisplay) {
      periodDisplay.textContent = this.dayNightCycle.getCurrentPeriod();
    }

    if (timeSlider) {
      timeSlider.value = this.dayNightCycle.currentTime;
    }
  }

  /**
   * Toggle UI visibility
   */
  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? "block" : "none";
    return this.isVisible;
  }

  /**
   * Show UI
   */
  show() {
    this.isVisible = true;
    this.container.style.display = "block";
  }

  /**
   * Hide UI
   */
  hide() {
    this.isVisible = false;
    this.container.style.display = "none";
  }
}
