"""
Backward-compatible entrypoint.
Use `python model_training.py` for full dataset-based training.
"""

from model_training import main

if __name__ == "__main__":
    main()
