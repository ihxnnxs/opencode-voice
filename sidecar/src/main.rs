use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use transcribe_cpp::{Model, RunOptions, TimestampKind};

struct Args {
    model: PathBuf,
    file: PathBuf,
    language: Option<String>,
}

fn usage() -> &'static str {
    "Usage: opencode-voice-transcribe --model <model.gguf> --file <audio.wav> [--language <iso-code>]"
}

fn parse_args() -> Result<Args, String> {
    let mut model = None;
    let mut file = None;
    let mut language = None;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        if arg == "--help" || arg == "-h" {
            return Err(usage().to_string());
        }
        if arg == "--version" || arg == "-V" {
            return Err(format!("opencode-voice-transcribe {} ({})", transcribe_cpp::version(), transcribe_cpp::version_commit()));
        }
        let value = args.next().ok_or_else(|| format!("Missing value for {arg}\n{}", usage()))?;
        match arg.as_str() {
            "--model" | "-m" => model = Some(PathBuf::from(value)),
            "--file" | "-f" => file = Some(PathBuf::from(value)),
            "--language" | "-l" => language = Some(value),
            _ => return Err(format!("Unknown argument: {arg}\n{}", usage())),
        }
    }

    Ok(Args {
        model: model.ok_or_else(|| format!("Missing --model\n{}", usage()))?,
        file: file.ok_or_else(|| format!("Missing --file\n{}", usage()))?,
        language,
    })
}

fn load_wav(path: &PathBuf) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|error| format!("Cannot open WAV: {error}"))?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 || spec.channels != 1 {
        return Err(format!(
            "Expected 16 kHz mono WAV, got {} Hz with {} channel(s)",
            spec.sample_rate, spec.channels
        ));
    }

    match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot read WAV samples: {error}")),
        hound::SampleFormat::Int => {
            let scale = match spec.bits_per_sample {
                8 => 128.0,
                16 => 32_768.0,
                24 => 8_388_608.0,
                32 => 2_147_483_648.0,
                bits => return Err(format!("Unsupported WAV bit depth: {bits}")),
            };
            reader
                .samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 / scale))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Cannot read WAV samples: {error}"))
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let pcm = load_wav(&args.file)?;
    let model = Model::load(&args.model).map_err(|error| format!("Cannot load model: {error}"))?;
    let mut session = model.session().map_err(|error| format!("Cannot create session: {error}"))?;
    let result = session
        .run(
            &pcm,
            &RunOptions {
                language: args.language,
                timestamps: TimestampKind::None,
                ..Default::default()
            },
        )
        .map_err(|error| format!("Transcription failed: {error}"))?;
    print!("{}", result.text.trim());
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) if message == usage() || message.starts_with("opencode-voice-transcribe ") => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
