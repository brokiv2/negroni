import AVFoundation
import NegroniCore
import UIKit

@MainActor final class ComposerView: UIView, UITextViewDelegate {
  let textView = UITextView()
  let modelButton = UIButton(type: .system)
  private let attachmentLabel = Theme.label("", style: .caption1)
  private let placeholder = Theme.label("Message…", style: .body, color: Theme.muted)
  private let attach = UIButton(type: .system), mic = UIButton(type: .system),
    send = UIButton(type: .system)
  private let content = Theme.stack(spacing: 0), entry = Theme.stack(.horizontal, spacing: 4)
  private let recordingRow = Theme.stack(.horizontal, spacing: 8)
  private let timerLabel = Theme.label("0:00", style: .title3)
  private let waveform = WaveformView()
  private let stateLabel = Theme.label("Dictating", style: .caption1, color: Theme.muted)
  private let recordingPanel = Theme.stack(spacing: 8)
  private var recorder: AVAudioRecorder?, meterTimer: Timer?, file: URL?,
    audioTask: Task<Void, Never>?
  private var origin: URL?
  private var processing = false
  private var recordingGeneration = 0
  private var heightConstraint: NSLayoutConstraint!
  private lazy var recordingHeight = heightAnchor.constraint(equalToConstant: 110)
  var onSend: ((String) -> Void)?, onStop: (() -> Void)?, onAttach: (() -> Void)?,
    onError: ((Error) -> Void)?, onVoiceSettings: (() -> Void)?
  var running = false { didSet { updateSend() } }
  var sending = false { didSet { updateSend() } }
  var uploading = false {
    didSet {
      updateSend()
      attach.isEnabled = !uploading
    }
  }
  var attachmentNames = "" {
    didSet {
      attachmentLabel.text = attachmentNames
      attachmentLabel.isHidden = attachmentNames.isEmpty
    }
  }
  var ready = false { didSet { updateSend() } }
  var attachmentCount = 0 {
    didSet {
      updateSend()
      attach.accessibilityValue = "\(attachmentCount) attachments"
    }
  }
  var draft: String { textView.text ?? "" }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = Theme.canvas
    directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
    content.backgroundColor = Theme.card
    content.layer.cornerRadius = 28
    content.layer.borderWidth = 0.5
    content.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    content.layer.borderColor = Theme.border.cgColor
    content.isLayoutMarginsRelativeArrangement = true
    content.directionalLayoutMargins = NSDirectionalEdgeInsets(
      top: 6, leading: 8, bottom: 4, trailing: 8)
    textView.font = .preferredFont(forTextStyle: .body)
    textView.adjustsFontForContentSizeCategory = true
    textView.textColor = Theme.ink
    textView.backgroundColor = .clear
    textView.delegate = self
    textView.addSubview(placeholder)
    placeholder.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      placeholder.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 7),
      placeholder.topAnchor.constraint(equalTo: textView.topAnchor, constant: 12),
    ])
    placeholder.isUserInteractionEnabled = false
    textView.textContainerInset = UIEdgeInsets(top: 12, left: 2, bottom: 10, right: 2)
    textView.accessibilityLabel = "Message"
    textView.isScrollEnabled = false
    textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    heightConstraint = textView.heightAnchor.constraint(equalToConstant: 44)
    heightConstraint.isActive = true
    configure(
      attach, symbol: "plus", label: "Attach file", action: { [weak self] in self?.onAttach?() })
    configure(
      mic, symbol: "mic", label: "Dictate message",
      action: { [weak self] in self?.startRecording() })
    configure(
      send, symbol: "arrow.up", label: "Send message",
      action: { [weak self] in
        guard let self else { return }
        if self.running && self.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          self.onStop?()
        } else {
          self.onSend?(self.draft)
        }
      })
    for item in [attach, textView, mic, send] { entry.addArrangedSubview(item) }
    entry.alignment = .bottom
    attachmentLabel.isHidden = true
    attachmentLabel.numberOfLines = 2
    content.addArrangedSubview(attachmentLabel)
    content.addArrangedSubview(entry)
    var modelConfig = UIButton.Configuration.plain()
    modelConfig.title = "Auto"
    modelConfig.image = UIImage(
      systemName: "chevron.down",
      withConfiguration: UIImage.SymbolConfiguration(pointSize: 9, weight: .medium))
    modelConfig.imagePlacement = .trailing
    modelConfig.imagePadding = 3
    modelConfig.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
      pointSize: 9, weight: .medium)
    modelConfig.baseForegroundColor = Theme.ink
    modelConfig.buttonSize = .small
    modelConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attr in
      var a = attr
      a.font = .preferredFont(forTextStyle: .caption1)
      return a
    }
    modelButton.configuration = modelConfig
    modelButton.contentHorizontalAlignment = .leading
    modelButton.accessibilityLabel = "Chat model"
    modelButton.showsMenuAsPrimaryAction = true
    modelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
    content.addArrangedSubview(modelButton)
    addSubview(content)
    content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      content.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor),
      content.topAnchor.constraint(equalTo: layoutMarginsGuide.topAnchor),
      content.bottomAnchor.constraint(equalTo: layoutMarginsGuide.bottomAnchor),
    ])
    setupRecording()
  }
  required init?(coder: NSCoder) { fatalError() }
  private func configure(
    _ button: UIButton, symbol: String, label: String, action: @escaping () -> Void
  ) {
    button.setImage(
      UIImage(
        systemName: symbol,
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)),
      for: .normal)
    button.tintColor = Theme.ink
    button.accessibilityLabel = label
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    NSLayoutConstraint.activate([
      button.widthAnchor.constraint(equalToConstant: 44),
      button.heightAnchor.constraint(equalToConstant: 44),
    ])
  }
  func setDraft(_ value: String) {
    textView.text = value
    textViewDidChange(textView)
  }
  func textViewDidChange(_ textView: UITextView) {
    placeholder.isHidden = !draft.isEmpty
    let height = min(
      140,
      max(
        44,
        textView.sizeThatFits(
          CGSize(width: max(100, textView.bounds.width), height: .greatestFiniteMagnitude)
        ).height))
    heightConstraint.constant = height
    textView.isScrollEnabled = height >= 140
    updateSend()
  }
  private func updateSend() {
    let hasText =
      !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || attachmentCount > 0
    send.setImage(UIImage(systemName: running && !hasText ? "stop.fill" : "arrow.up"), for: .normal)
    send.accessibilityLabel =
      running && !hasText ? "Stop response" : running ? "Send follow-up" : "Send message"
    send.isEnabled = ready && !sending && !uploading && (hasText || running)
    send.backgroundColor = send.isEnabled ? Theme.ink : Theme.secondary
    send.tintColor = send.isEnabled ? Theme.card : Theme.muted
    send.layer.cornerRadius = 22
    mic.isEnabled = ready && !sending && !processing
  }
  private func setupRecording() {
    recordingPanel.isHidden = true
    waveform.backgroundColor = .clear
    waveform.isOpaque = false
    let cancel = Theme.button(
      "Cancel", action: { [weak self] in self?.cancelRecording() })
    cancel.configuration?.background.backgroundColor = Theme.card
    cancel.configuration?.cornerStyle = .capsule
    cancel.heightAnchor.constraint(equalToConstant: 60).isActive = true
    cancel.configuration?.buttonSize = .small
    cancel.widthAnchor.constraint(equalToConstant: 76).isActive = true
    let capsule = Theme.stack(.horizontal, spacing: 8)
    capsule.alignment = .center
    capsule.distribution = .fill
    capsule.isLayoutMarginsRelativeArrangement = true
    capsule.directionalLayoutMargins = NSDirectionalEdgeInsets(
      top: 8, leading: 12, bottom: 8, trailing: 12)
    timerLabel.font = .monospacedDigitSystemFont(ofSize: 20, weight: .regular)
    timerLabel.setContentHuggingPriority(.required, for: .horizontal)
    let stop = UIButton(type: .system)
    stop.setImage(UIImage(systemName: "stop.fill"), for: .normal)
    stop.accessibilityLabel = "Stop recording and edit"
    stop.addAction(
      UIAction { [weak self] _ in self?.finishRecording(sendAfter: false) }, for: .touchUpInside)
    stop.widthAnchor.constraint(equalToConstant: 30).isActive = true
    capsule.addArrangedSubview(stop)
    capsule.addArrangedSubview(timerLabel)
    capsule.addArrangedSubview(waveform)
    let glass: UIView
    if #available(iOS 26.0, *) {
      let effect = UIGlassEffect(style: .regular)
      effect.isInteractive = true
      let view = UIVisualEffectView(effect: effect)
      view.contentView.addSubview(capsule)
      capsule.pin(to: view.contentView)
      glass = view
    } else {
      glass = UIView()
      glass.backgroundColor = Theme.card
      glass.addSubview(capsule)
      capsule.pin(to: glass)
    }
    glass.layer.cornerRadius = 30
    glass.clipsToBounds = true
    glass.heightAnchor.constraint(equalToConstant: 60).isActive = true
    let sendRecording = Theme.button(nil, symbol: "arrow.up", primary: true) { [weak self] in
      self?.finishRecording(sendAfter: true)
    }
    sendRecording.accessibilityLabel = "Send recording"
    sendRecording.widthAnchor.constraint(equalToConstant: 56).isActive = true
    recordingRow.addArrangedSubview(cancel)
    recordingRow.addArrangedSubview(glass)
    recordingRow.addArrangedSubview(sendRecording)
    recordingPanel.addArrangedSubview(stateLabel)
    recordingPanel.addArrangedSubview(recordingRow)
    addSubview(recordingPanel)
    recordingPanel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      recordingPanel.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor),
      recordingPanel.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor),
      recordingPanel.topAnchor.constraint(equalTo: layoutMarginsGuide.topAnchor),
    ])
  }
  private func showRecording(_ visible: Bool) {
    content.isHidden = visible
    recordingPanel.isHidden = !visible
    // Keep the composer anchored while switching input modes; UIKit handles keyboard motion.
    recordingHeight.isActive = visible
    invalidateIntrinsicContentSize()
    superview?.layoutIfNeeded()
  }
  func startRecording() {
    guard recorder == nil, !processing else { return }
    let generation = recordingGeneration
    timerLabel.text = "0:00"
    waveform.reset()
    processing = true
    updateSend()
    audioTask = Task {
      do {
        let status = try await API.shared.rpc("voice/status")
        guard generation == recordingGeneration, !Task.isCancelled else { return }
        guard status["transcribe"].bool else {
          processing = false
          updateSend()
          onVoiceSettings?()
          return
        }
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
          throw APIError(status: 0, message: "Enable microphone access in iOS Settings to dictate.")
        }
        guard generation == recordingGeneration, !Task.isCancelled else { return }
        textView.resignFirstResponder()
        origin = API.shared.base
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try audio.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString + ".m4a")
        file = url
        let recorder = try AVAudioRecorder(
          url: url,
          settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue, AVEncoderBitRateKey: 96000,
          ])
        recorder.isMeteringEnabled = true
        guard recorder.record() else {
          throw APIError(status: 0, message: "The microphone could not start.")
        }
        self.recorder = recorder
        processing = false
        stateLabel.text = "Dictating"
        showRecording(true)
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
          Task { @MainActor in self?.updateMeter() }
        }
      } catch {
        processing = false
        cancelRecording()
        onError?(error)
      }
    }
  }
  private func updateMeter() {
    guard let recorder else { return }
    recorder.updateMeters()
    let seconds = Int(recorder.currentTime)
    timerLabel.text = "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    waveform.addLevel(CGFloat(max(0, min(1, (recorder.averagePower(forChannel: 0) + 60) / 60))))
  }
  private func finishRecording(sendAfter: Bool) {
    guard let recorder, !processing else { return }
    let generation = recordingGeneration
    recorder.stop()
    self.recorder = nil
    meterTimer?.invalidate()
    meterTimer = nil
    processing = true
    stateLabel.text = "Transcribing…"
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    guard let file else {
      cancelRecording()
      return
    }
    audioTask = Task {
      do {
        guard API.shared.base == origin else { throw CancellationError() }
        let data = try Data(contentsOf: file)
        let transcript = try await API.shared.transcribe(data)
        guard generation == recordingGeneration, API.shared.base == origin, !Task.isCancelled else {
          return
        }
        let next = ThreadLogic.append(draft, transcript: transcript)
        setDraft(next)
        cancelRecording()
        if sendAfter && !transcript.isEmpty {
          onSend?(next)
        } else {
          textView.becomeFirstResponder()
        }
      } catch {
        if generation == recordingGeneration {
          cancelRecording()
          onError?(error)
        }
      }
    }
  }
  func cancelRecording() {
    recordingGeneration += 1
    audioTask?.cancel()
    audioTask = nil
    recorder?.stop()
    recorder = nil
    meterTimer?.invalidate()
    meterTimer = nil
    if let file { try? FileManager.default.removeItem(at: file) }
    file = nil
    processing = false
    showRecording(false)
    updateSend()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

final class WaveformView: UIView {
  private var levels: [CGFloat] = Array(repeating: 0.1, count: 13)
  override var intrinsicContentSize: CGSize { CGSize(width: 64, height: 28) }
  func reset() {
    levels = Array(repeating: 0.1, count: 13)
    setNeedsDisplay()
  }
  func addLevel(_ value: CGFloat) {
    levels.removeFirst()
    levels.append(value)
    setNeedsDisplay()
  }
  override func draw(_ rect: CGRect) {
    Theme.muted.setFill()
    let width = min(3, max(1, (rect.width - 24) / 13))
    for (index, level) in levels.enumerated() {
      let height = 5 + level * 20
      UIBezierPath(
        roundedRect: CGRect(
          x: CGFloat(index) * (width + 2), y: (rect.height - height) / 2, width: width,
          height: height), cornerRadius: 2
      ).fill()
    }
  }
}
